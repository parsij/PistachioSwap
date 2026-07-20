import { motion, useReducedMotion } from 'motion/react'
import TokenIcon from '../../tokens/components/TokenIcon.jsx'
import { swapUiConfig } from '../../../swapConfig.js'
import { ChevronDownIcon } from '../../../shared/components/AppIcons.jsx'
import { getTokenIdentity } from '../../tokens/model/tokenNormalization.js'

/**
 * Renders the selected-token or select-token button without owning selection state.
 * @param {{token: object|null, onClick: () => void}} props Presentation props.
 * @returns {import('react').ReactElement} Existing animated token button markup.
 * @sideEffects Calls `onClick` after user activation; no network or wallet operations.
 */
export function SwapTokenButton({ token, onClick }) {
    const reducedMotion = useReducedMotion()
    const { copy, motion: motionConfig } = swapUiConfig

    if (!token) {
        return (
            <motion.button
                type="button"
                onClick={onClick}
                className="token-button select-token-button"
                whileTap={reducedMotion ? undefined : { scale: motionConfig.tokenButton.pressedScale }}
            >
                <span>{copy.selectToken}</span>
                <ChevronDownIcon className="token-chevron" />
            </motion.button>
        )
    }

    return (
        <motion.button
            type="button"
            onClick={onClick}
            className="token-button selected-token-button"
            whileTap={reducedMotion ? undefined : { scale: motionConfig.tokenButton.pressedScale }}
        >
            <TokenIcon token={token} size="button" />
            <span>{token.symbol}</span>
            <ChevronDownIcon className="token-chevron" />
        </motion.button>
    )
}

/**
 * Adds the stable token-identity layout animation wrapper around `SwapTokenButton`.
 * @param {{token: object|null, chainId: number, onClick: () => void}} props Component props.
 * @returns {import('react').ReactElement} Motion layout wrapper and token button.
 * @security The layout identity uses exact chain/address token identity.
 */
export function AnimatedSwapTokenButton({ token, chainId, onClick }) {
    const { motion: motionConfig } = swapUiConfig
    const identity = getTokenIdentity(token, chainId)
    return (
        <motion.div layoutId={`token-${identity}`} transition={{ layout: motionConfig.sharedLayout }}>
            <SwapTokenButton token={token} onClick={onClick} />
        </motion.div>
    )
}
