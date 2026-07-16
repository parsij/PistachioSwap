const messages = {
    BELOW_SPONSOR_MINIMUM: 'The amount is below this wallet-token sponsor minimum.',
    ABOVE_SPONSOR_MAXIMUM: 'The amount is above this wallet-token sponsor maximum.',
    GAS_ASSIST_RULE_NOT_FOUND: 'This wallet and token do not have an enabled sponsor rule.',
    SWAP_INTENT_NOT_CUSTOM_CONTRACT: 'This quote does not execute through the PistachioSwap contract.',
    ONCHAIN_APPROVAL_REQUIRED: 'This token needs a one-time on-chain approval and cannot currently be rescued without BNB.',
    UNLIMITED_PERMIT_NOT_ALLOWED: 'This permit is broader than the configured Gas Assist policy allows.',
    SELL_VALUE_TOO_LOW: 'The sell value is below the Gas Assist minimum.',
    USER_OUTPUT_TOO_LOW: 'The expected BNB output is too small after fees.',
    PRICE_IMPACT_TOO_HIGH: 'This Gas Assist quote has excessive price impact.',
    QUOTE_EXPIRED: 'This Gas Assist quote expired.',
}

export default function GasAssistError({ error }) {
    const code = typeof error === 'string' ? error : error?.code
    const message = messages[code] ?? error?.message ?? 'This trade is not eligible for Gas Assist.'
    return <p className="gas-assist-error" role="alert">{message}</p>
}
