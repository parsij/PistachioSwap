import { useCallback, useEffect, useMemo, useRef } from 'react'

import { usePrepaidSponsorship } from '../../gas-assist/hooks/usePrepaidSponsorship.js'
import { useSponsorshipPreview } from '../../gas-assist/hooks/useSponsorshipPreview.js'
import { getDisplayTokenPrice } from '../../tokens/services/tokenPrices.js'
import {
    estimateCrossChainGasAssistInput,
    previewCoversNativeGas,
} from '../services/crossChainGasAssist.js'

/** Uses the existing prepaid whitelist flow to buy only the BNB needed by a prepared BSC source route. */
export function useCrossChainGasAssist({
    quoteEndpoint,
    account,
    sellToken,
    nativeToken,
    totalInputRaw,
    slippageBps,
    preparation,
    nativeBalanceWei,
    sponsorshipConfig,
    onConfirmed,
}) {
    const confirmedRef = useRef({ grossInputAmount: null, onConfirmed })
    const required = Boolean(
        preparation?.status === 'ready' && preparation?.insufficientNativeGas &&
        preparation?.requiredNativeGasWei && Number(sellToken?.chainId) === 56 &&
        sellToken?.isNative !== true && nativeToken?.isNative === true,
    )
    const grossInputAmount = useMemo(() => required
        ? estimateCrossChainGasAssistInput({
            totalInputRaw,
            tokenDecimals: sellToken?.decimals,
            tokenPriceUsd: getDisplayTokenPrice(sellToken),
            sourceGasUsd: preparation?.sourceGasUsd,
            requiredNativeGasWei: preparation?.requiredNativeGasWei,
            nativeBalanceWei,
            fixedFeeUsd: sponsorshipConfig?.fixedFeeUsd,
            platformFeeBps: sponsorshipConfig?.platformFeeBps,
        })
        : null, [nativeBalanceWei, preparation, required, sellToken, sponsorshipConfig, totalInputRaw])
    useEffect(() => {
        confirmedRef.current = { grossInputAmount, onConfirmed }
    }, [grossInputAmount, onConfirmed])
    const handleConfirmed = useCallback(() => {
        const current = confirmedRef.current
        return current.onConfirmed?.(current.grossInputAmount)
    }, [])
    const sponsorship = usePrepaidSponsorship({
        quoteEndpoint,
        walletAddress: account,
        sellToken,
        buyToken: nativeToken,
        grossInputAmount,
        slippageBps: Math.max(30, slippageBps),
        required,
        onConfirmed: handleConfirmed,
    })
    const preview = useSponsorshipPreview({
        quoteEndpoint,
        walletAddress: account,
        sellToken,
        buyToken: nativeToken,
        grossInputAmount,
        slippageBps: Math.max(30, slippageBps),
        required,
        enabled: sponsorshipConfig?.enabled === true && Boolean(grossInputAmount),
    })
    const coversShortfall = previewCoversNativeGas({
        preview: preview.preview,
        requiredNativeGasWei: preparation?.requiredNativeGasWei,
        nativeBalanceWei,
    })
    const available = required && Boolean(grossInputAmount) && sponsorshipConfig?.enabled === true &&
        preview.status === 'success' && coversShortfall
    async function start() {
        if (!available) return false
        await sponsorship.start()
        return true
    }

    return {
        required,
        available,
        grossInputAmount,
        preview: preview.preview,
        status: !required ? 'idle' : !grossInputAmount ? 'unavailable' : preview.status,
        error: preview.error,
        sponsorship,
        start,
    }
}
