import {
    erc20Abi,
    isAddress,
    parseUnits,
    zeroAddress,
} from 'viem'

import {
    getNativeSpendableWei,
    getTokenBalanceWei,
} from './balances.js'
import {
    requireCuratedEvmChain,
} from '../web3/curatedEvmChains.js'

export const TRANSFER_ABI = erc20Abi

export function isNativeEvmToken(token) {
    return Boolean(token?.isNative) ||
        String(token?.address ?? '').toLowerCase() === zeroAddress
}

export function createTransferPlan({
    account,
    chainId,
    recipient,
    amount,
    token,
    nativeBalanceWei,
    estimatedFeeWei = 0n,
}) {
    if (!isAddress(account ?? '')) throw new Error('Connect a wallet first.')
    const chain = requireCuratedEvmChain(chainId)
    const nativeSymbol = chain.nativeCurrency.symbol
    if (Number(token?.chainId) !== Number(chainId)) {
        throw new Error(`Select a token on ${chain.name}.`)
    }
    if (!isAddress(recipient ?? '')) throw new Error('Enter a valid recipient address.')
    if (!Number.isInteger(Number(token?.decimals))) {
        throw new Error('Token decimals are unavailable.')
    }

    let amountWei
    try {
        amountWei = parseUnits(String(amount ?? ''), Number(token.decimals))
    } catch {
        throw new Error('Enter a valid amount.')
    }
    if (amountWei <= 0n) throw new Error('Amount must be greater than zero.')

    const tokenBalanceWei = isNativeEvmToken(token)
        ? BigInt(nativeBalanceWei ?? 0)
        : getTokenBalanceWei(token)

    if (amountWei > tokenBalanceWei) throw new Error('Insufficient balance.')

    const fee = BigInt(estimatedFeeWei ?? 0)
    if (isNativeEvmToken(token)) {
        const spendable = getNativeSpendableWei({
            balanceWei: nativeBalanceWei,
            estimatedFeeWei: fee,
        })
        if (amountWei > spendable) {
            throw new Error(`Insufficient ${nativeSymbol} for amount and network fee.`)
        }
        return {
            kind: 'native',
            amountWei,
            request: {
                account,
                chainId: chain.id,
                to: recipient,
                value: amountWei,
            },
        }
    }

    if (BigInt(nativeBalanceWei ?? 0) < fee) {
        throw new Error(`Insufficient ${nativeSymbol} for gas.`)
    }

    return {
        kind: 'erc20',
        amountWei,
        request: {
            account,
            chainId: chain.id,
            address: token.address,
            abi: TRANSFER_ABI,
            functionName: 'transfer',
            args: [recipient, amountWei],
        },
    }
}

export function isTransferRejectedError(error) {
    const code = Number(error?.code ?? error?.cause?.code)
    const message = String(error?.shortMessage ?? error?.message ?? '').toLowerCase()
    return code === 4001 || code === 5000 ||
        message.includes('user rejected') ||
        message.includes('user denied') ||
        message.includes('rejected the request')
}
