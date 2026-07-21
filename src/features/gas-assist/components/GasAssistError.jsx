const messages = {
    BELOW_SPONSOR_MINIMUM: 'The amount is below this wallet-token sponsor minimum.',
    ABOVE_SPONSOR_MAXIMUM: 'The amount is above this wallet-token sponsor maximum.',
    GAS_ASSIST_RULE_NOT_FOUND: 'This wallet and token do not have an enabled sponsor rule.',
    SWAP_INTENT_NOT_CUSTOM_CONTRACT: 'This quote does not execute through the PistachioSwap contract.',
    ONCHAIN_APPROVAL_REQUIRED: 'This token needs an exact sponsored approval before the swap.',
    UNLIMITED_PERMIT_NOT_ALLOWED: 'This permit is broader than the configured Gas Assist policy allows.',
    SELL_VALUE_TOO_LOW: 'The legacy Gasless sell value is below its configured minimum.',
    GAS_ASSIST_FEE_NOT_REPRESENTABLE: 'The legacy provider fee is too large for this trade. Exact prepaid Gas Assist is required.',
    GROSS_TRADE_VALUE_UNECONOMIC: 'The gross trade value is below the exact prepaid minimum.',
    NET_TRADE_VALUE_UNECONOMIC: 'After sponsorship charges, the remaining swap value is below the minimum.',
    PAYMENT_EXCEEDS_GROSS_INPUT: 'The sponsorship charge would leave no token amount to swap.',
    OUTPUT_VALUE_UNECONOMIC: 'The minimum output after sponsorship charges is too small.',
    PAYMENT_TRANSFER_UNECONOMIC: 'The sponsorship payment is too small relative to its transfer cost.',
    USER_OUTPUT_TOO_LOW: 'The expected user output is too small after fees.',
    PRICE_IMPACT_TOO_HIGH: 'This Gas Assist quote has excessive price impact.',
    QUOTE_EXPIRED: 'This Gas Assist quote expired.',
}

/** Presents the existing safe Gas Assist error message and details. */
export default function GasAssistError({ error }) {
    const code = typeof error === 'string' ? error : error?.code
    const message = messages[code] ?? error?.message ?? 'This trade is not eligible for Gas Assist.'
    return <p className="gas-assist-error" role="alert">{message}</p>
}
