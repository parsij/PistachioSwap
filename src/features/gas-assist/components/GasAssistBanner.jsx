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
            <span className="gas-assist-badge">Gas Assist · Prepaid sponsorship</span>
            <strong>{pair} needs Gas Assist because this wallet does not have enough BNB for normal network gas.</strong>
            <p>
                PistachioSwap can sponsor the BNB needed for the token approval and swap instead of sending a normal transaction that the wallet cannot pay for.
            </p>
            <p>
                Gas-assisted swaps have a higher fee than normal swaps because the fee includes the sponsored network-gas reserve plus Gas Assist service and trade fees. The exact fee and minimum output are shown before you sign anything.
            </p>
        </aside>
    )
}
