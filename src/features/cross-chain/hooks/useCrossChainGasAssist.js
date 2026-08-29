import { useMemo } from 'react'

/**
 * Cross-chain Gas Assist was retired with the sequential sponsorship package.
 * Keep a stable unavailable shape so cross-chain swaps continue normally.
 */
export function useCrossChainGasAssist() {
    return useMemo(() => ({
        required: false,
        expected: false,
        available: false,
        grossInputAmount: '0',
        preview: null,
        status: 'unavailable',
        error: null,
        sponsorship: null,
        start: async () => false,
    }), [])
}
