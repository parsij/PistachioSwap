import { getTokenDisplaySymbol } from '../../tokens/services/tokenDisplay.js'
/**
 * Explains why a low-BNB same-chain swap is routed through prepaid Gas Assist.
 * The exact backend-authoritative fee is shown in the prepayment review before signing.
 * @param {{sellToken: object|null, buyToken: object|null}} props Active swap tokens.
 * @returns {import('react').ReactElement} Gas Assist disclosure banner.
 * @sideEffects None.
 */
export default function GasAssistBanner({ sellToken, buyToken }) {
    const pair = sellToken?.symbol && buyToken?.symbol
        ? `${getTokenDisplaySymbol(sellToken)} → ${getTokenDisplaySymbol(buyToken)}`
        : 'This swap'

    return (
        <aside className="gas-assist-banner" aria-label="Gas Assist information">
            <span className="gas-assist-badge">Gas Assist · Quoted sponsorship</span>
            <strong>{pair} needs Gas Assist because this wallet does not have enough BNB for normal network gas.</strong>
            <p>
                PistachioSwap can sponsor one BNB Chain transaction for the disclosed fee, exact approval, and swap instead of sending a normal transaction that the wallet cannot pay for.
            </p>
            <p>
                The quoted service charge includes gas estimates, pricing margins, and applicable service and trade fees. It can exceed actual network gas, and PistachioSwap retains the difference. The exact fee and minimum output are shown before you sign anything.
            </p>
        </aside>
    )
}
