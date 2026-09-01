from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


hook = r'''import { useCallback, useRef, useState } from 'react'

import { usePrepaidSponsorship } from '../../gas-assist/hooks/usePrepaidSponsorship.js'

/**
 * Sponsors the exact BNB Chain source transaction through the direct atomic
 * EIP-7702 Gas Assist flow. Cross-chain route mutation authentication remains
 * scoped to the prepared route; no sequential payment/approval package is used.
 */
export function useCrossChainGasAssist({
    quoteEndpoint,
    account,
    sellToken,
    buyToken,
    totalInputRaw,
    slippageBps,
    route,
    expected,
    preparation,
    sponsorshipConfig,
    previewSponsorship,
    authenticateSponsorship,
    prepareSponsorship,
    completeSponsorship,
    onConfirmed,
}) {
    const preparedResponseRef = useRef(null)
    const previewOperationRef = useRef(false)
    const contextRef = useRef(null)
    contextRef.current = {
        account: String(account ?? '').toLowerCase(),
        routeId: route?.publicRouteId ?? null,
        grossInputAmount: String(totalInputRaw ?? ''),
    }
    const [previewStatus, setPreviewStatus] = useState('idle')
    const [previewError, setPreviewError] = useState(null)
    const required = Boolean(
        (expected === true || (
            preparation?.status === 'ready' &&
            preparation?.insufficientNativeGas
        )) &&
        Number(sellToken?.chainId) === 56 &&
        sellToken?.isNative !== true,
    )

    const createOrder = useCallback(async ({ idempotencyKey }) => {
        const preparedRoute = preparedResponseRef.current?.preparedRoute
        if (!preparedRoute) {
            throw new Error('The cross-chain Gas Assist preview expired. Start again.')
        }
        await authenticateSponsorship(preparedRoute)
        const result = await prepareSponsorship(idempotencyKey)
        preparedResponseRef.current = result
        return result.order
    }, [authenticateSponsorship, prepareSponsorship])

    const handleSubmitted = useCallback(async (order) => {
        const prepared = preparedResponseRef.current
        if (!prepared?.preparedRoute || !order?.swapTransactionHash) {
            throw new Error('The sponsored cross-chain transaction is incomplete.')
        }
        await completeSponsorship({
            preparedRoute: prepared.preparedRoute,
            transactionHash: order.swapTransactionHash,
        })
    }, [completeSponsorship])

    const handleConfirmed = useCallback(async (order) => {
        await onConfirmed?.(order, preparedResponseRef.current?.preparedRoute)
    }, [onConfirmed])

    const sponsorship = usePrepaidSponsorship({
        quoteEndpoint,
        walletAddress: account,
        sellToken,
        buyToken,
        grossInputAmount: totalInputRaw,
        slippageBps: Math.max(30, slippageBps),
        required,
        createOrder,
        onSubmitted: handleSubmitted,
        onConfirmed: handleConfirmed,
    })
    const available = required && sponsorshipConfig?.enabled === true &&
        sponsorshipConfig?.atomicExecution === true &&
        typeof previewSponsorship === 'function' &&
        typeof authenticateSponsorship === 'function' &&
        typeof prepareSponsorship === 'function' &&
        typeof completeSponsorship === 'function'

    async function start() {
        if (!available || previewOperationRef.current) return false
        previewOperationRef.current = true
        sponsorship.openPreviewLoading()
        const contextAtStart = { ...contextRef.current }
        preparedResponseRef.current = null
        setPreviewStatus('loading')
        setPreviewError(null)
        try {
            const preview = await previewSponsorship(route)
            if (
                contextRef.current.account !== contextAtStart.account ||
                contextRef.current.routeId !== contextAtStart.routeId ||
                contextRef.current.grossInputAmount !== contextAtStart.grossInputAmount
            ) return false
            preparedResponseRef.current = preview
            sponsorship.reviewOrder(preview.order)
            setPreviewStatus('success')
            return true
        } catch (error) {
            setPreviewStatus('error')
            setPreviewError(error)
            sponsorship.failPreview(error)
            console.error('[pistachio-swap] Cross-chain Gas Assist preview failed', {
                code: error?.code ?? 'CROSS_CHAIN_GAS_ASSIST_PREVIEW_FAILED',
                message: error?.message ?? 'Gas Assist preview failed.',
                requestId: error?.requestId ?? null,
            })
            throw error
        } finally {
            previewOperationRef.current = false
        }
    }

    const reviewSponsorship = {
        ...sponsorship,
        error: previewStatus === 'error' ? previewError : sponsorship.error,
        refreshing: previewStatus === 'loading' && sponsorship.open,
        refreshQuote: start,
    }

    return {
        required,
        expected: expected === true,
        available,
        grossInputAmount: totalInputRaw,
        preview: null,
        status: !required
            ? 'idle'
            : previewStatus === 'loading'
                ? 'loading'
                : previewStatus === 'error'
                    ? 'error'
                    : sponsorship.configStatus === 'loading'
                        ? 'loading'
                        : available ? 'success' : 'unavailable',
        error: previewError ?? sponsorship.configError ?? sponsorship.error,
        sponsorship: reviewSponsorship,
        start,
    }
}
'''
Path('src/features/cross-chain/hooks/useCrossChainGasAssist.js').write_text(hook)

path = Path('src/features/swap/hooks/useSwapController.js')
text = path.read_text()
text = replace_once(
    text,
    "import { deriveSwapEligibility } from '../model/swapEligibility.js'",
    "import { deriveSwapEligibility, expectsCrossChainGasAssist } from '../model/swapEligibility.js'",
    'cross-chain eligibility import',
)
text = replace_once(
    text,
    '    const crossChainGasAssist = useCrossChainGasAssist()\n',
    '''    async function handleCrossChainGasAssistConfirmed() {
        try {
            crossChain.review.close()
            receipt.setTransactionStatus('submitted')
            setStatusMessage('Cross-chain swap submitted with Gas Assist.')
            await catalog.refreshWalletBalances()
        } catch (error) {
            console.error('[pistachio-swap] Cross-chain Gas Assist status update failed', error)
            setStatusMessage('The sponsored cross-chain transaction was sent. Refresh activity to follow its status.')
        }
    }
    const crossChainGasAssistExpected = expectsCrossChainGasAssist({
        prepaidEnabled: routing.sponsorshipConfig.config?.enabled,
        routingMode: routing.routingMode,
        crossChainMode: routing.modes.CROSS_CHAIN,
        nativeBalanceValue: catalog.nativeBalance.value,
        nativeGasReserve: walletConfig.nativeGasReserve,
        sellChainId: routing.sellChainId,
        sellToken: inputs.sellToken,
    })
    const crossChainGasAssist = useCrossChainGasAssist({
        quoteEndpoint: quoteConfig.endpoint,
        account: walletState.address,
        sellToken: inputs.sellToken,
        buyToken: inputs.buyToken,
        totalInputRaw: inputs.activeAmountIn,
        slippageBps: configuredSlippageBps,
        route: crossChain.currentRoute,
        expected: crossChainGasAssistExpected,
        preparation: crossChain.review.preparation,
        sponsorshipConfig: routing.sponsorshipConfig.config,
        previewSponsorship: crossChain.routes.previewSponsorship,
        authenticateSponsorship: crossChain.routes.authenticateSponsorship,
        prepareSponsorship: crossChain.routes.prepareSponsorship,
        completeSponsorship: crossChain.routes.completeSponsorship,
        onConfirmed: handleCrossChainGasAssistConfirmed,
    })
''',
    'cross-chain Gas Assist controller wiring',
)
path.write_text(text)
