import { AnimatePresence } from 'motion/react'
import TokenSelector from './TokenSelector.jsx'

/**
 * Owns the existing AnimatePresence boundary around the feature token selector.
 * @param {{open: boolean, selectorProps: object}} props Overlay contract.
 * @returns {import('react').ReactElement} Animated selector portal boundary.
 * @sideEffects The child may move focus and query its provided catalog callbacks; no requests originate here.
 */
export default function TokenSelectorOverlay({ open, selectorProps }) {
    return (
        <AnimatePresence>
            {open && <TokenSelector {...selectorProps} />}
        </AnimatePresence>
    )
}
