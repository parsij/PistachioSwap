import { describe, expect, it } from 'vitest'

import {
    KNOWN_PISTACHIO_BSC_CONTRACT_ADDRESSES,
    walletActivityInternals,
} from '../src/modules/wallet-activity.js'

const wallet = '0x0000000000000000000000000000000000000001'
const sellToken = '0x55d398326f99059ff775485246999027b3197955'
const buyToken = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'
const firstPistachioContract =
    '0x517b6c94da086f3f69dc725d7d70cdba7c4a9b62'
const secondPistachioContract =
    '0x21331d393a0622eeddffce3e9db29448b6110bc6'

function transfer({
    address,
    direction,
    amount,
}: {
    address: string
    direction: 'incoming' | 'outgoing'
    amount: string
}) {
    const outgoing = direction === 'outgoing'
    return {
        address,
        token_address: address,
        token_symbol: address === buyToken ? 'WBNB' : 'USDT',
        token_name: address === buyToken ? 'Wrapped BNB' : 'Tether USD',
        token_decimals: '18',
        value_formatted: amount,
        value: amount === '10'
            ? '10000000000000000000'
            : '20000000000000000',
        from_address: outgoing ? wallet : firstPistachioContract,
        to_address: outgoing ? firstPistachioContract : wallet,
        direction,
        possible_spam: false,
    }
}

function row(overrides: Record<string, unknown> = {}) {
    return {
        hash: `0x${'1'.padStart(64, '0')}`,
        receipt_status: '1',
        summary: 'Exec',
        method_label: 'Exec',
        category: 'contract interaction',
        input: '0x12345678',
        block_timestamp: '2026-09-01T12:00:00.000Z',
        from_address: wallet,
        to_address: firstPistachioContract,
        erc20_transfers: [],
        native_transfers: [],
        ...overrides,
    }
}

describe('complete wallet history policy', () => {
    it('keeps both user-provided Pistachio BNB Chain contracts as known history identities', () => {
        expect(KNOWN_PISTACHIO_BSC_CONTRACT_ADDRESSES).toContain(firstPistachioContract)
        expect(KNOWN_PISTACHIO_BSC_CONTRACT_ADDRESSES).toContain(secondPistachioContract)
    })

    it('recognizes an unambiguously swapped token flow through a known Pistachio contract', () => {
        const item = walletActivityInternals.normalizeMoralisActivity(
            56,
            wallet,
            row({
                erc20_transfers: [
                    transfer({
                        address: sellToken,
                        direction: 'outgoing',
                        amount: '10',
                    }),
                    transfer({
                        address: buyToken,
                        direction: 'incoming',
                        amount: '0.02',
                    }),
                ],
            }),
        )

        expect(item).toMatchObject({
            type: 'swapped',
            sellAmount: '10',
            buyAmount: '0.02',
            provider: 'pistachio-contract',
            sellToken: expect.objectContaining({ symbol: 'USDT' }),
            buyToken: expect.objectContaining({ symbol: 'WBNB' }),
        })
    })

    it('keeps user-initiated sends, approvals, swaps, and contract calls without portfolio trust metadata', () => {
        const policy = walletActivityInternals.activityPassesTrustPolicy
        const trustedTokens = new Map()
        for (const type of ['sent', 'approved', 'swapped', 'contract']) {
            expect(policy({ chainId: 56, type }, trustedTokens)).toBe(true)
        }
    })

    it('still requires trusted-token evidence for unsolicited received-token history', () => {
        const allowed = walletActivityInternals.activityPassesTrustPolicy(
            {
                chainId: 56,
                type: 'received',
                token: {
                    address: '0x0000000000000000000000000000000000000666',
                    symbol: 'SPAM',
                    name: 'Spam',
                    decimals: 18,
                    isNative: false,
                    logoURI: null,
                },
            },
            new Map(),
        )
        expect(allowed).toBe(false)
    })

    it('keeps a successful user-initiated contract call even when it has no token transfers', () => {
        const item = walletActivityInternals.normalizeMoralisActivity(
            56,
            wallet,
            row({ to_address: secondPistachioContract }),
        )
        expect(item).toMatchObject({
            type: 'contract',
            recipient: secondPistachioContract,
        })
    })
})
