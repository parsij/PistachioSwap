import { describe, expect, it, vi } from 'vitest'

import { CrossChainRegistry } from '../src/cross-chain/registry.js'
import type {
    CrossChainAdapter,
    CrossChainProviderName,
    CrossChainQuote,
    CrossChainRequest,
    ProviderCapabilities,
} from '../src/cross-chain/types.js'

const owner = '0x0000000000000000000000000000000000000001'
const sourceToken = '0x0000000000000000000000000000000000000011'
const destinationToken = '0x0000000000000000000000000000000000000022'
const target = '0x0000000000000000000000000000000000000033'
const spender = '0x0000000000000000000000000000000000000044'

const request: CrossChainRequest = {
    mode: 'exactIn',
    sourceAsset: { chainId: 56, address: sourceToken, symbol: 'SRC', decimals: 18 },
    destinationAsset: { chainId: 137, address: destinationToken, symbol: 'DST', decimals: 18 },
    amount: '1000',
    ownerAddress: owner,
    recipient: owner,
    slippageBps: 50,
    walletCapabilities: {
        evmTransaction: true,
        depositChannel: false,
        vaultSwap: false,
    },
}

function adapter(
    name: CrossChainProviderName,
    buyAmount: (amount: string) => string,
    quoteSpy: ReturnType<typeof vi.fn>,
): CrossChainAdapter {
    const capabilities: ProviderCapabilities = {
        provider: name,
        available: true,
        fetchedAt: new Date().toISOString(),
        routes: [{
            sourceChainId: 56,
            destinationChainId: 137,
            transactionTargets: [target],
            approvalSpenders: [spender],
        }],
    }
    return {
        name,
        async getCapabilities() {
            return capabilities
        },
        async getQuote(nextRequest) {
            quoteSpy(nextRequest.amount)
            return {
                provider: name,
                quoteId: `${name}:${nextRequest.amount}:${quoteSpy.mock.calls.length}`,
                request: nextRequest,
                buyAmount: buyAmount(nextRequest.amount),
                minimumBuyAmount: '1',
                fees: [],
                estimatedDurationSeconds: 60,
                executionModel: 'evm-transaction',
                steps: [],
                transaction: {
                    chainId: 56,
                    to: target,
                    data: '0x1234',
                    value: '0',
                    allowanceTarget: spender,
                },
                deposit: null,
                statusId: null,
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
            } satisfies CrossChainQuote
        },
        async getStatus(statusId) {
            return {
                provider: name,
                statusId,
                status: 'unknown',
                sourceTransactionHash: null,
                destinationTransactionHash: null,
            }
        },
    }
}

describe('CrossChainRegistry.requoteProvider', () => {
    it('keeps sponsorship stabilization on the originally selected provider', async () => {
        const acrossQuote = vi.fn()
        const relayQuote = vi.fn()
        const registry = new CrossChainRegistry([
            adapter('across', (amount) => amount === '1000' ? '950' : '940', acrossQuote),
            adapter('relay', (amount) => amount === '1000' ? '900' : '999', relayQuote),
        ])

        const initial = await registry.quote(request)
        expect(initial.selectedQuote.provider).toBe('across')
        expect(acrossQuote).toHaveBeenCalledTimes(1)
        expect(relayQuote).toHaveBeenCalledTimes(1)

        const requoted = await registry.requoteProvider(
            initial.selectedQuote.quoteId,
            '800',
            undefined,
            '1000',
        )

        expect(requoted.provider).toBe('across')
        expect(requoted.request.amount).toBe('800')
        expect(requoted.sponsoredGrossInputAmount).toBe('1000')
        expect(acrossQuote).toHaveBeenCalledTimes(2)
        expect(relayQuote).toHaveBeenCalledTimes(1)
    })
})
