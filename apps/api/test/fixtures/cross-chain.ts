import type {
    CrossChainAdapter,
    CrossChainProviderName,
    CrossChainQuote,
    CrossChainRequest,
    CrossChainStatusResult,
    ProviderCapabilities,
} from '../../src/cross-chain/types.js'

export const sourceToken = '0x0000000000000000000000000000000000000001'
export const destinationToken = '0x0000000000000000000000000000000000000002'
export const sender = '0x0000000000000000000000000000000000000003'
export const target = '0x0000000000000000000000000000000000000004'

export const request: CrossChainRequest = {
    mode: 'exactIn',
    sourceAsset: { chainId: 1, address: sourceToken, symbol: null, decimals: null },
    destinationAsset: { chainId: 8453, address: destinationToken, symbol: null, decimals: null },
    amount: '1000',
    ownerAddress: sender,
    recipient: sender,
    slippageBps: 50,
    walletCapabilities: {
        evmTransaction: true,
        depositChannel: true,
        vaultSwap: false,
    },
}

export function fixtureAdapter(
    provider: CrossChainProviderName,
    minimumBuyAmount: string,
    feeAmount = '0',
): CrossChainAdapter {
    let capabilityCalls = 0
    const capabilities: ProviderCapabilities = {
        provider,
        available: true,
        fetchedAt: '2026-01-01T00:00:00.000Z',
        routes: [{
            sourceChainId: 1,
            destinationChainId: 8453,
            transactionTargets: [target],
        }],
    }
    return {
        name: provider,
        getCapabilities: async () => {
            capabilityCalls += 1
            return capabilities
        },
        getQuote: async (quoteRequest) => {
            const transaction = {
                chainId: 1,
                to: target,
                data: '0x1234',
                value: '0',
                allowanceTarget: target,
            }
            return {
            provider,
            quoteId: `${provider}-quote`,
            request: quoteRequest,
            buyAmount: minimumBuyAmount,
            minimumBuyAmount,
            fees: feeAmount === '0' ? [] : [{
                type: 'provider',
                token: destinationToken,
                amount: feeAmount,
            }],
            estimatedDurationSeconds: 30,
            executionModel: 'evm-transaction',
            steps: [{
                id: 'source',
                index: 0,
                type: 'source-transaction',
                label: 'Submit source',
                chainId: 1,
                status: 'ready',
                transaction,
            }],
            transaction,
            deposit: null,
            statusId: `${provider}-status`,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }},
        getStatus: async (statusId): Promise<CrossChainStatusResult> => ({
            provider,
            statusId,
            status: 'completed',
            sourceTransactionHash: null,
            destinationTransactionHash: null,
        }),
        get capabilityCalls() {
            return capabilityCalls
        },
    } as CrossChainAdapter & { capabilityCalls: number }
}

export function fixtureQuote(overrides: Partial<CrossChainQuote> = {}): CrossChainQuote {
    const transaction = {
        chainId: 1,
        to: target,
        data: '0x',
        value: '0',
        allowanceTarget: null,
    }
    return {
        provider: 'across',
        quoteId: 'fixture',
        request,
        buyAmount: '900',
        minimumBuyAmount: '890',
        fees: [],
        estimatedDurationSeconds: 60,
        executionModel: 'evm-transaction',
        steps: [{
            id: 'source',
            index: 0,
            type: 'source-transaction',
            label: 'Submit source',
            chainId: 1,
            status: 'ready',
            transaction,
        }],
        transaction,
        deposit: null,
        statusId: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        ...overrides,
    }
}
