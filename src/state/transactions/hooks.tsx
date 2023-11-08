import { TransactionResponse } from '@ethersproject/providers'
import { useCallback, useMemo } from 'react'
import { useSelector } from 'react-redux'
import { Order } from '@gelatonetwork/limit-orders-lib'
import useActiveWeb3React from 'hooks/useActiveWeb3React'
import fromPairs from 'lodash/fromPairs'
import mapValues from 'lodash/mapValues'
import keyBy from 'lodash/keyBy'
import orderBy from 'lodash/orderBy'
import isEmpty from 'lodash/isEmpty'
import { TransactionDetails } from './reducer'
import { addTransaction, TransactionType } from './actions'
import { AppState, useAppDispatch } from '../index'

// helper that can take a ethers library transaction response and add it to the list of transactions
export function useTransactionAdder(): (
  response: TransactionResponse,
  customData?: {
    summary?: string
    translatableSummary?: { text: string; data?: Record<string, string | number> }
    approval?: { tokenAddress: string; spender: string }
    claim?: { recipient: string }
    type?: TransactionType
    order?: Order
  },
) => void {
  const { chainId, account } = useActiveWeb3React()
  const dispatch = useAppDispatch()

  return useCallback(
    (
      response: TransactionResponse,
      {
        summary,
        translatableSummary,
        approval,
        claim,
        type,
        order,
      }: {
        summary?: string
        translatableSummary?: { text: string; data?: Record<string, string | number> }
        claim?: { recipient: string }
        approval?: { tokenAddress: string; spender: string }
        type?: TransactionType
        order?: Order
      } = {},
    ) => {
      if (!account) return
      if (!chainId) return

      const { hash } = response
      if (!hash) {
        throw Error('No transaction hash found.')
      }
      dispatch(
        addTransaction({ hash, from: account, chainId, approval, summary, translatableSummary, claim, type, order }),
      )
    },
    [dispatch, chainId, account],
  )
}

// returns all the transactions
export function useAllTransactions(): { [chainId: number]: { [txHash: string]: TransactionDetails } } {
  const { account } = useActiveWeb3React()

  const state: {
    [chainId: number]: {
      [txHash: string]: TransactionDetails
    }
  } = useSelector<AppState, AppState['transactions']>((s) => s.transactions)

  return useMemo(() => {
    return fromPairs(
      Object.entries(state).map(([chainId, transactions]) => [
        chainId,
        fromPairs(
          Object.entries(transactions).filter(
            ([_, transactionDetails]) => transactionDetails.from.toLowerCase() === account?.toLowerCase(),
          ),
        ),
      ]),
    )
  }, [account, state])
}

export function useAllSortedRecentTransactions(): { [chainId: number]: { [txHash: string]: TransactionDetails } } {
  const allTransactions = useAllTransactions()
  return useMemo(() => {
    return fromPairs(
      Object.entries(allTransactions)
        .map(([chainId, transactions]) => {
          return [
            chainId,
            mapValues(
              keyBy(
                orderBy(
                  Object.entries(transactions)
                    .filter(([_, trxDetails]) => isTransactionRecent(trxDetails))
                    .map(([hash, trxDetails]) => ({ hash, trxDetails })),
                  ['trxDetails', 'addedTime'],
                  'desc',
                ),
                'hash',
              ),
              'trxDetails',
            ),
          ]
        })
        .filter(([_, transactions]) => !isEmpty(transactions)),
    )
  }, [allTransactions])
}

// returns all the transactions for the current chain
export function useAllChainTransactions(): { [txHash: string]: TransactionDetails } {
  const { account, chainId } = useActiveWeb3React()

  const state = useSelector<AppState, AppState['transactions']>((s) => s.transactions)

  return useMemo(() => {
    if (chainId && state[chainId]) {
      return fromPairs(
        Object.entries(state[chainId]).filter(
          ([_, transactionDetails]) => transactionDetails.from.toLowerCase() === account?.toLowerCase(),
        ),
      )
    }
    return {}
  }, [account, chainId, state])
}

export function useIsTransactionPending(transactionHash?: string): boolean {
  const transactions = useAllChainTransactions()

  if (!transactionHash || !transactions[transactionHash]) return false

  return !transactions[transactionHash].receipt
}

/**
 * Returns whether a transaction happened in the last day (86400 seconds * 1000 milliseconds / second)
 * @param tx to check for recency
 */
export function isTransactionRecent(tx: TransactionDetails): boolean {
  return new Date().getTime() - tx.addedTime < 86_400_000
}

// returns whether a token has a pending approval transaction
export function useHasPendingApproval(tokenAddress: string | undefined, spender: string | undefined): boolean {
  const allTransactions = useAllChainTransactions()
  return useMemo(
    () =>
      typeof tokenAddress === 'string' &&
      typeof spender === 'string' &&
      Object.keys(allTransactions).some((hash) => {
        const tx = allTransactions[hash]
        if (!tx) return false
        if (tx.receipt) {
          return false
        }
        const { approval } = tx
        if (!approval) return false
        return approval.spender === spender && approval.tokenAddress === tokenAddress && isTransactionRecent(tx)
      }),
    [allTransactions, spender, tokenAddress],
  )
}

// we want the latest one to come first, so return negative if a is after b
function newTransactionsFirst(a: TransactionDetails, b: TransactionDetails) {
  return b.addedTime - a.addedTime
}

// calculate pending transactions
export function usePendingTransactions(): { hasPendingTransactions: boolean; pendingNumber: number } {
  const allTransactions = useAllChainTransactions()
  const sortedRecentTransactions = useMemo(() => {
    const txs = Object.values(allTransactions)
    return txs.filter(isTransactionRecent).sort(newTransactionsFirst)
  }, [allTransactions])

  const pending = sortedRecentTransactions.filter((tx) => !tx.receipt).map((tx) => tx.hash)
  const hasPendingTransactions = !!pending.length

  return {
    hasPendingTransactions,
    pendingNumber: pending.length,
  }
}