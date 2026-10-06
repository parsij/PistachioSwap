export const GAS_ASSIST_SOURCE_CHAIN_IDS = Object.freeze([
    1,
    10,
    56,
    100,
    130,
    137,
    8453,
    34443,
    42161,
    42220,
    59144,
    80094,
    534352,
])

const GAS_ASSIST_SOURCE_CHAIN_ID_SET = new Set(GAS_ASSIST_SOURCE_CHAIN_IDS)

export function isGasAssistSourceChainId(value) {
    const chainId = Number(value)
    return Number.isSafeInteger(chainId) &&
        GAS_ASSIST_SOURCE_CHAIN_ID_SET.has(chainId)
}
