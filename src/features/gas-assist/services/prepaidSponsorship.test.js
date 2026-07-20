import { describe, expect, it, vi } from 'vitest'

import { createSponsorshipOrder } from './prepaidSponsorship.js'

describe('prepaid sponsorship frontend trust boundary', () => {
    it.each(['paymentToken', 'spender', 'router', 'calldata', 'gasLimit', 'policyUuid'])('rejects frontend field %s', async (field) => {
        const fetcher = vi.spyOn(globalThis, 'fetch')
        expect(() => createSponsorshipOrder(
            'http://localhost:3001/v1/quote',
            'session',
            {
                sellToken: '0x1111111111111111111111111111111111111111',
                buyToken: 'native',
                grossInputAmount: '100',
                slippageBps: 50,
                [field]: 'injected',
            },
            'test-order-1',
        )).toThrow(/unsupported fields/)
        expect(fetcher).not.toHaveBeenCalled()
        fetcher.mockRestore()
    })
})
