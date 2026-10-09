import { useEffect, useState } from 'react'
import { encodeFunctionData, erc20Abi, isAddress } from 'viem'
import { decimalToUnits } from '../../swap/model/amountMath.js'
import { isNativeEvmToken } from '../../../services/transfers.js'

/** Read-only preview. An incomplete form has a clearly marked preliminary estimate. */
export function useSendGasEstimate({ publicClient, chainId, account, token, amount, recipient, enabled }) {
    const tokenAddress = token?.address
    const native = isNativeEvmToken(token)
    const raw = decimalToUnits(amount, Number(token?.decimals ?? 18))
    const complete = raw !== null && BigInt(raw) > 0n && isAddress(recipient ?? '')
    const key = `${chainId}:${account}:${token?.address}:${raw}:${recipient}`
    const [state, setState] = useState(null)
    useEffect(() => {
        if (!enabled || !tokenAddress || !isAddress(account ?? '')) return
        let live = true
        let version = 0
        const run = async () => {
            const requestVersion = ++version
            try {
                if (Number(publicClient?.chain?.id) !== Number(chainId) || Number(await publicClient.getChainId()) !== Number(chainId)) {
                    throw new Error('Network cost is unavailable on this token’s chain.')
                }
                const to = isAddress(recipient ?? '') ? recipient : account
                const value = raw !== null && BigInt(raw) > 0n ? BigInt(raw) : native ? 0n : 1n
                const request = native ? { account, to, value } : { account, to: tokenAddress, value: 0n,
                    data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, value] }) }
                const gas = await publicClient.estimateGas(request)
                if (typeof gas !== 'bigint' || gas <= 0n) throw new Error('Gas estimate unavailable.')
                if (live && version === requestVersion) setState({ key, gas: (gas * 120n + 99n) / 100n, preliminary: !complete })
            } catch {
                if (live && version === requestVersion) setState({ key, error: 'Live transfer cost unavailable. Enter the amount and recipient or retry.' })
            }
        }
        const timer = setTimeout(() => void run(), 250)
        const refresh = setInterval(() => { if (document.visibilityState !== 'hidden') void run() }, 15_000)
        return () => { live = false; clearTimeout(timer); clearInterval(refresh) }
    }, [publicClient, chainId, account, tokenAddress, raw, recipient, native, complete, key, enabled])
    return state?.key === key ? state : { loading: enabled }
}
