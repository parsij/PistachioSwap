import {
    erc20Abi,
    isAddress,
    parseUnits,
} from 'viem'

import {
    BSC_CHAIN_ID,
    getNativeSpendableWei,
    getTokenBalanceWei,
    isNativeBnbToken,
} from './balances.js'

export const TRANSFER_ABI = erc20Abi

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
    if (Number(chainId) !== BSC_CHAIN_ID) {
        throw new Error('Switch to BNB Smart Chain before sending.')
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

    const tokenBalanceWei = isNativeBnbToken(token)
        ? BigInt(nativeBalanceWei ?? 0)
        : getTokenBalanceWei(token)

    if (amountWei > tokenBalanceWei) throw new Error('Insufficient balance.')

    const fee = BigInt(estimatedFeeWei ?? 0)
    if (isNativeBnbToken(token)) {
        const spendable = getNativeSpendableWei({
            balanceWei: nativeBalanceWei,
            estimatedFeeWei: fee,
        })
        if (amountWei > spendable) {
            throw new Error('Insufficient BNB for amount and network fee.')
        }
        return {
            kind: 'native',
            amountWei,
            request: {
                account,
                chainId: BSC_CHAIN_ID,
                to: recipient,
                value: amountWei,
            },
        }
    }

    if (BigInt(nativeBalanceWei ?? 0) < fee) {
        throw new Error('Insufficient BNB for gas.')
    }

    return {
        kind: 'erc20',
        amountWei,
        request: {
            account,
            chainId: BSC_CHAIN_ID,
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
