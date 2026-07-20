import { motion } from 'motion/react'
import { ArrowDownIcon } from '../../../shared/components/AppIcons.jsx'

/** Renders the animated sell/buy direction switch and emits one semantic callback. */
export default function SwapDirectionButton({ ariaLabel, rotation, reducedMotion, motionConfig, onSwitchTokens }) {
    return (
        <motion.button
            type="button"
            className="switch-button"
            aria-label={ariaLabel}
            onClick={onSwitchTokens}
            style={{ x: '-50%' }}
            animate={{ rotate: rotation }}
            whileTap={reducedMotion ? undefined : { scale: motionConfig.pressedScale }}
            transition={reducedMotion ? { duration: 0 } : {
                duration: motionConfig.duration,
                ease: motionConfig.ease,
            }}
        >
            <ArrowDownIcon />
        </motion.button>
    )
}
