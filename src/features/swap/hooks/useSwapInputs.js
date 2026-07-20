import { useEffect, useMemo, useState } from 'react'
import { formatUnits } from 'viem'
import { resolveSelectedToken } from '../../tokens/services/walletTokens.js'
import { getDisplayTokenPrice } from '../../tokens/services/tokenPrices.js'
import { formatUsdAmount } from '../../../services/fiatValue.js'
import { getTokenIdentity, normalizeMarketToken } from '../../tokens/model/tokenNormalization.js'
import {
    decimalToUnits,
    divideDecimalToUnits,
    isDecimalInput,
    multiplyUnitsByDecimal,
} from '../model/amountMath.js'
import { tokenDiagnostic } from '../../../shared/logging/swapDiagnostics.js'

export const TOKEN_DENOMINATION = 'TOKEN'
export const USD_DENOMINATION = 'USD'

/**
 * Owns token selection, amount editing, denomination, active-side, and direction-switch state.
 *
 * @param {object} config Input configuration and token catalog.
 * @returns {object} Input state, normalized raw intent, display values, and semantic mutation operations.
 * @sideEffects Updates React state and existing input diagnostics; performs no HTTP, RPC, wallet, or storage calls.
 * @security Raw-unit conversion is exact and rejects precision beyond token decimals.
 */
export function useSwapInputs({
    tokensConfig,
    tabs,
    availableTokens,
    swapChainId,
    setSwapChainId,
    fallbackChainLogo,
    setVisibleStatus,
    diagnostic,
}) {
    const initialSellToken = useMemo(() => tokensConfig.initialSellToken
        ? normalizeMarketToken(tokensConfig.initialSellToken, swapChainId, fallbackChainLogo)
        : null, [fallbackChainLogo, swapChainId, tokensConfig.initialSellToken])
    const initialBuyToken = useMemo(() => tokensConfig.initialBuyToken
        ? normalizeMarketToken(tokensConfig.initialBuyToken, swapChainId, fallbackChainLogo)
        : null, [fallbackChainLogo, swapChainId, tokensConfig.initialBuyToken])

    const [activeTab, setActiveTab] = useState(tabs[0])
    const [selectedSellToken, setSelectedSellToken] = useState(initialSellToken)
    const [selectedBuyToken, setSelectedBuyToken] = useState(initialBuyToken)
    const [sellAmount, setSellAmount] = useState('')
    const [buyAmount, setBuyAmount] = useState('0')
    const [sellInputDenomination, setSellInputDenomination] = useState(TOKEN_DENOMINATION)
    const [buyInputDenomination, setBuyInputDenomination] = useState(TOKEN_DENOMINATION)
    const [activeAmountSide, setActiveAmountSide] = useState('sell')
    const [showQuickAmounts, setShowQuickAmounts] = useState(false)
    const [switchRotation, setSwitchRotation] = useState(0)

    const sellToken = useMemo(
        () => resolveSelectedToken(selectedSellToken, availableTokens),
        [availableTokens, selectedSellToken],
    )
    const buyToken = useMemo(
        () => resolveSelectedToken(selectedBuyToken, availableTokens),
        [availableTokens, selectedBuyToken],
    )
    const sellDisplayPrice = getDisplayTokenPrice(sellToken)
    const buyDisplayPrice = getDisplayTokenPrice(buyToken)
    const sellUsdEligible = Boolean(sellDisplayPrice)
    const buyUsdEligible = Boolean(buyDisplayPrice)
    const activeAmountIn = sellToken
        ? sellInputDenomination === USD_DENOMINATION
            ? divideDecimalToUnits(sellAmount, sellDisplayPrice, Number(sellToken.decimals ?? 18), 'down')
            : decimalToUnits(sellAmount, Number(sellToken.decimals ?? 18))
        : null
    const activeBuyAmountIn = buyToken
        ? buyInputDenomination === USD_DENOMINATION
            ? divideDecimalToUnits(buyAmount, buyDisplayPrice, Number(buyToken.decimals ?? 18), 'down')
            : decimalToUnits(buyAmount, Number(buyToken.decimals ?? 18))
        : null

    const sellTokenDisplayAmount = activeAmountIn && sellToken
        ? formatUnits(BigInt(activeAmountIn), Number(sellToken.decimals ?? 18))
        : ''
    const buyTokenDisplayAmount = activeBuyAmountIn && buyToken
        ? formatUnits(BigInt(activeBuyAmountIn), Number(buyToken.decimals ?? 18))
        : ''
    const sellFiatValue = sellInputDenomination === USD_DENOMINATION
        ? sellAmount ? `$${sellAmount}` : '$0'
        : formatUsdAmount(sellAmount || '0', sellDisplayPrice)
    const buyFiatValue = buyInputDenomination === USD_DENOMINATION
        ? buyAmount ? `$${buyAmount}` : '$0'
        : formatUsdAmount(buyAmount, buyDisplayPrice)
    const sellSecondaryValue = sellInputDenomination === USD_DENOMINATION
        ? sellToken && sellTokenDisplayAmount
            ? `${sellTokenDisplayAmount} ${sellToken.symbol}`
            : `0 ${sellToken?.symbol ?? ''}`.trim()
        : sellFiatValue
    const buySecondaryValue = buyInputDenomination === USD_DENOMINATION
        ? buyToken && buyTokenDisplayAmount
            ? `${buyTokenDisplayAmount} ${buyToken.symbol}`
            : `0 ${buyToken?.symbol ?? ''}`.trim()
        : buyFiatValue

    useEffect(() => {
        if (sellInputDenomination === USD_DENOMINATION && !sellUsdEligible) {
            setSellInputDenomination(TOKEN_DENOMINATION)
            setVisibleStatus('USD input is unavailable for this token.')
        }
    }, [sellInputDenomination, sellUsdEligible, setVisibleStatus])

    useEffect(() => {
        if (buyInputDenomination === USD_DENOMINATION && !buyUsdEligible) {
            setBuyInputDenomination(TOKEN_DENOMINATION)
            setVisibleStatus('USD input is unavailable for this token.')
        }
    }, [buyInputDenomination, buyUsdEligible, setVisibleStatus])

    function updateSellAmount(nextValue) {
        if (!isDecimalInput(nextValue)) return false
        diagnostic('input.amount.changed', {
            side: 'sell', denomination: sellInputDenomination, rawInput: nextValue, token: tokenDiagnostic(sellToken),
        })
        setActiveAmountSide('sell')
        setSellAmount(nextValue)
        if (!nextValue) {
            setBuyAmount('0')
            diagnostic('quote.state.reset', { reason: 'empty-sell-amount' })
        }
        return true
    }

    function updateBuyAmount(nextValue) {
        if (!isDecimalInput(nextValue)) return false
        diagnostic('input.amount.changed', {
            side: 'buy', denomination: buyInputDenomination, rawInput: nextValue, token: tokenDiagnostic(buyToken),
        })
        setActiveAmountSide('buy')
        setBuyAmount(nextValue)
        if (!nextValue) {
            setSellAmount('')
            diagnostic('quote.state.reset', { reason: 'empty-buy-amount' })
        }
        return true
    }

    function switchTokens() {
        diagnostic('input.tokens.switched', {
            previousSellToken: tokenDiagnostic(sellToken),
            previousBuyToken: tokenDiagnostic(buyToken),
        })
        setSwitchRotation((rotation) => rotation + 180)
        setSelectedSellToken(buyToken)
        setSelectedBuyToken(sellToken)
        if (buyToken?.chainId) setSwapChainId(Number(buyToken.chainId))
        setSellAmount(buyAmount === '0' ? '' : buyAmount)
        setBuyAmount(sellAmount || '0')
    }

    function setTokenAmountFromUnits(side, rawAmount) {
        const token = side === 'sell' ? sellToken : buyToken
        if (!token) return
        const tokenAmount = formatUnits(BigInt(rawAmount), Number(token.decimals ?? 18))
        const price = side === 'sell' ? sellDisplayPrice : buyDisplayPrice
        const usdAmount = multiplyUnitsByDecimal(rawAmount, Number(token.decimals ?? 18), price)
        if (side === 'sell') {
            setActiveAmountSide('sell')
            setSellAmount(sellInputDenomination === USD_DENOMINATION && usdAmount !== null ? usdAmount : tokenAmount)
        } else {
            setActiveAmountSide('buy')
            setBuyAmount(buyInputDenomination === USD_DENOMINATION && usdAmount !== null ? usdAmount : tokenAmount)
        }
    }

    function toggleDenomination(side) {
        if (side === 'sell') {
            if (sellInputDenomination === TOKEN_DENOMINATION) {
                if (!sellUsdEligible) {
                    setVisibleStatus('USD input is unavailable for this token.')
                    diagnostic('input.denomination.blocked', { side, reason: 'missing-sell-usd-price', token: tokenDiagnostic(sellToken) }, 'warn')
                    return
                }
                const nextAmount = activeAmountIn
                    ? multiplyUnitsByDecimal(activeAmountIn, Number(sellToken?.decimals ?? 18), sellDisplayPrice)
                    : null
                setSellInputDenomination(USD_DENOMINATION)
                if (nextAmount !== null) setSellAmount(nextAmount)
                setActiveAmountSide('sell')
                diagnostic('input.denomination.changed', { side, denomination: USD_DENOMINATION, amount: nextAmount, token: tokenDiagnostic(sellToken) })
                return
            }
            const nextAmount = activeAmountIn && sellToken
                ? formatUnits(BigInt(activeAmountIn), Number(sellToken.decimals ?? 18))
                : ''
            setSellInputDenomination(TOKEN_DENOMINATION)
            setSellAmount(nextAmount)
            setActiveAmountSide('sell')
            diagnostic('input.denomination.changed', { side, denomination: TOKEN_DENOMINATION, amount: nextAmount, token: tokenDiagnostic(sellToken) })
            return
        }
        if (buyInputDenomination === TOKEN_DENOMINATION) {
            if (!buyUsdEligible) {
                setVisibleStatus('USD input is unavailable for this token.')
                diagnostic('input.denomination.blocked', { side, reason: 'missing-buy-usd-price', token: tokenDiagnostic(buyToken) }, 'warn')
                return
            }
            const nextAmount = activeBuyAmountIn
                ? multiplyUnitsByDecimal(activeBuyAmountIn, Number(buyToken?.decimals ?? 18), buyDisplayPrice)
                : null
            setBuyInputDenomination(USD_DENOMINATION)
            if (nextAmount !== null) setBuyAmount(nextAmount)
            setActiveAmountSide('buy')
            diagnostic('input.denomination.changed', { side, denomination: USD_DENOMINATION, amount: nextAmount, token: tokenDiagnostic(buyToken) })
            return
        }
        const nextAmount = activeBuyAmountIn && buyToken
            ? formatUnits(BigInt(activeBuyAmountIn), Number(buyToken.decimals ?? 18))
            : ''
        setBuyInputDenomination(TOKEN_DENOMINATION)
        setBuyAmount(nextAmount)
        setActiveAmountSide('buy')
        diagnostic('input.denomination.changed', { side, denomination: TOKEN_DENOMINATION, amount: nextAmount, token: tokenDiagnostic(buyToken) })
    }

    function selectToken({ token, side, selectorChainId }) {
        const normalizedToken = normalizeMarketToken(token, selectorChainId, fallbackChainLogo)
        diagnostic('input.token.selected', {
            side,
            token: tokenDiagnostic(normalizedToken),
            previousSellToken: tokenDiagnostic(sellToken),
            previousBuyToken: tokenDiagnostic(buyToken),
        })
        const selectedIdentity = getTokenIdentity(normalizedToken, selectorChainId)
        const sellIdentity = getTokenIdentity(sellToken, swapChainId)
        const buyIdentity = getTokenIdentity(buyToken, swapChainId)
        if (side === 'sell') {
            if (selectedIdentity === buyIdentity) setSelectedBuyToken(sellToken)
            setSelectedSellToken(normalizedToken)
            setSwapChainId(Number(normalizedToken.chainId))
        }
        if (side === 'buy') {
            if (selectedIdentity === sellIdentity) setSelectedSellToken(buyToken)
            setSelectedBuyToken(normalizedToken)
            if (!sellToken) setSwapChainId(Number(normalizedToken.chainId))
        }
    }

    function resetInputsAfterSuccess() {
        setSellAmount('')
        setBuyAmount('0')
    }

    return {
        activeTab,
        setActiveTab,
        sellToken,
        buyToken,
        sellAmount,
        buyAmount,
        setSellAmount,
        setBuyAmount,
        sellInputDenomination,
        buyInputDenomination,
        activeAmountSide,
        activeAmountIn,
        activeBuyAmountIn,
        sellDisplayPrice,
        buyDisplayPrice,
        sellSecondaryValue,
        buySecondaryValue,
        sellIdentity: getTokenIdentity(sellToken, swapChainId),
        buyIdentity: getTokenIdentity(buyToken, swapChainId),
        showQuickAmounts,
        setShowQuickAmounts,
        switchRotation,
        updateSellAmount,
        updateBuyAmount,
        switchTokens,
        setTokenAmountFromUnits,
        toggleDenomination,
        selectToken,
        resetInputsAfterSuccess,
    }
}
