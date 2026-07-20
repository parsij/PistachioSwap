import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { multiplyAmountByPercent } from '../../../services/balances.js'
import { swapUiConfig } from '../../../swapConfig.js'

/**
 * Renders animated percentage shortcuts for the current spendable token balance.
 * @param {{visible: boolean, token: object|null, spendableAmount: string, onSelect: (amount: string) => void}} props Component props.
 * @returns {import('react').ReactElement} Existing quick-amount controls.
 * @sideEffects Calls `onSelect` with a decimal token amount; no provider or wallet calls.
 */
export default function SwapQuickAmounts({ visible, token, spendableAmount, onSelect }) {
    const reducedMotion = useReducedMotion()
    const { motion: motionConfig, quickAmounts } = swapUiConfig
    const animation = motionConfig.quickAmounts
    const containerVariants = {
        hidden: {
            opacity: 0,
            x: reducedMotion ? 0 : animation.offsetX,
            filter: reducedMotion ? 'blur(0px)' : `blur(${animation.blur}px)`,
        },
        visible: {
            opacity: 1,
            x: 0,
            filter: 'blur(0px)',
            transition: reducedMotion ? { duration: 0 } : {
                duration: animation.duration,
                ease: animation.ease,
                staggerChildren: animation.stagger,
            },
        },
        exit: {
            opacity: 0,
            x: reducedMotion ? 0 : animation.offsetX,
            filter: reducedMotion ? 'blur(0px)' : `blur(${animation.blur}px)`,
            transition: reducedMotion ? { duration: 0 } : {
                duration: animation.duration * 0.75,
                ease: animation.ease,
            },
        },
    }
    const itemVariants = {
        hidden: { opacity: 0, x: reducedMotion ? 0 : 6 },
        visible: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: reducedMotion ? 0 : 4 },
    }

    return (
        <AnimatePresence initial={false}>
            {visible && token && (
                <motion.div
                    key="quick-amount-controls"
                    className="quick-amount-controls"
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                >
                    {quickAmounts.map((item) => (
                        <motion.button
                            key={item.label}
                            type="button"
                            className="quick-amount-button"
                            variants={itemVariants}
                            onClick={() => onSelect(multiplyAmountByPercent(
                                spendableAmount,
                                Number(token.decimals ?? 18),
                                item.percent,
                            ))}
                        >
                            {item.label}
                        </motion.button>
                    ))}
                </motion.div>
            )}
        </AnimatePresence>
    )
}
