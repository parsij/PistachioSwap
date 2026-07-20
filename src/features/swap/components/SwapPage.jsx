import PasskeyVaultTestPanel from '../../passkey/components/PasskeyVaultTestPanel.jsx'
import PistachioWalletController from '../../passkey/components/PistachioWalletController.jsx'
import SwapToolbar from './SwapToolbar.jsx'
import SwapCard from './SwapCard.jsx'
import TokenSelectorOverlay from '../../tokens/components/TokenSelectorOverlay.jsx'
import SameChainReviewDialog from './SameChainReviewDialog.jsx'
import GasAssistDialogs from '../../gas-assist/components/GasAssistDialogs.jsx'
import CrossChainReviewDialog from '../../cross-chain/components/CrossChainReviewDialog.jsx'

/**
 * Composes the complete swap feature page from grouped presentation view models.
 * @param {{toolbar: object, card: object, tokenSelector: object, sameChainReview: object, gasAssistDialogs: object, crossChainReview: object}} props Page view model.
 * @returns {import('react').ReactElement} Swap page, feature dialogs, and wallet/passkey overlays.
 * @sideEffects Presentation children emit callbacks; network/wallet behavior remains in feature controllers.
 */
export default function SwapPage({ toolbar, card, tokenSelector, sameChainReview, gasAssistDialogs, crossChainReview }) {
    return (
        <>
            <PasskeyVaultTestPanel />
            <section className="swap-root">
                <SwapToolbar {...toolbar} />
                <SwapCard {...card} />
            </section>
            <TokenSelectorOverlay {...tokenSelector} />
            <GasAssistDialogs {...gasAssistDialogs} />
            <SameChainReviewDialog {...sameChainReview} />
            <CrossChainReviewDialog {...crossChainReview} />
            <PistachioWalletController />
        </>
    )
}
