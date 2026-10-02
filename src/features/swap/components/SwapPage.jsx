import { lazy, Suspense } from 'react'
import { motion, useReducedMotion } from 'motion/react'

import PistachioWalletController from '../../passkey/components/PistachioWalletController.jsx'
import SwapToolbar from './SwapToolbar.jsx'
import SwapCard from './SwapCard.jsx'
import TokenSelectorOverlay from '../../tokens/components/TokenSelectorOverlay.jsx'
import SameChainReviewDialog from './SameChainReviewDialog.jsx'
import GasAssistDialogs from '../../gas-assist/components/GasAssistDialogs.jsx'
import CrossChainReviewDialog from '../../cross-chain/components/CrossChainReviewDialog.jsx'
import PendingWalletOperation from '../../wallet/components/wallet/PendingWalletOperation.jsx'

const PasskeyVaultTestPanel = import.meta.env.DEV
    ? lazy(() => import('../../passkey/components/PasskeyVaultTestPanel.jsx'))
    : null

/**
 * Composes the complete swap feature page from grouped presentation view models.
 * @param {{toolbar: object, card: object, tokenSelector: object, sameChainReview: object, gasAssistDialogs: object, crossChainReview: object}} props Page view model.
 * @returns {import('react').ReactElement} Swap page, feature dialogs, and wallet/passkey overlays.
 * @sideEffects Presentation children emit callbacks; network/wallet behavior remains in feature controllers.
 */
export default function SwapPage({ toolbar, card, tokenSelector, sameChainReview, gasAssistDialogs, crossChainReview, operationStatus }) {
    const reducedMotion = useReducedMotion()

    return (
        <>
            {PasskeyVaultTestPanel && (
                <Suspense fallback={null}>
                    <PasskeyVaultTestPanel />
                </Suspense>
            )}
            <PendingWalletOperation walletAddress={operationStatus?.walletAddress ?? null} />
            <motion.section
                className="swap-root"
                initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={reducedMotion ? { duration: 0 } : {
                    duration: 0.28,
                    ease: [0.22, 1, 0.36, 1],
                }}
            >
                <SwapToolbar {...toolbar} />
                <SwapCard {...card} />
            </motion.section>
            <TokenSelectorOverlay {...tokenSelector} />
            <GasAssistDialogs {...gasAssistDialogs} />
            <SameChainReviewDialog {...sameChainReview} />
            <CrossChainReviewDialog {...crossChainReview} />
            <PistachioWalletController />
        </>
    )
}
