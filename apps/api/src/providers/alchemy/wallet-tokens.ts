import {
    normalizeAddress,
} from '../../lib/address.js'
import {
    usesShapeShiftDexScreenerPricing,
} from '../wallet-price-request-scope.js'
import { getTokenMetadataBatch } from './token-metadata.js'
import { alchemyRpc } from './alchemy-client.js'
import {
    clearWalletTokenCacheForTest,
    getAlchemyTokenBalancesPaginated,
    getWalletTokens as baseGetWalletTokens,
    type WalletTokenInventory,
} from './wallet-tokens-base.js'

export * from './wallet-tokens-base.js'

type GetWalletTokensArgs = Parameters<typeof baseGetWalletTokens>[0]

function nativeBalance(value: unknown) {
    if (typeof value !== 'string' || !/^0x[a-fA-F0-9]+$/u.test(value)) {
        return null
    }
    try {
        return BigInt(value)
    } catch {
        return null
    }
}

async function completeMetadata(
    inventory: WalletTokenInventory,
    args: GetWalletTokensArgs,
) {
    const metadata = new Map(inventory.metadata)
    const missing = [...inventory.balances.keys()].filter(
        (address) => !metadata.has(address),
    )
    if (missing.length === 0) return metadata
    const loaded = await getTokenMetadataBatch({
        chainId: args.chainId,
        addresses: missing,
        signal: args.signal,
    }).catch(() => new Map())
    for (const [address, value] of loaded) {
        if (value) metadata.set(address, value)
    }
    return metadata
}

async function completeNativeBalance(
    inventory: WalletTokenInventory,
    args: GetWalletTokensArgs,
) {
    if (inventory.nativeBalance !== null) return inventory.nativeBalance
    const result = await alchemyRpc(
        {
            id: 'native-wallet-balance',
            jsonrpc: '2.0',
            method: 'eth_getBalance',
            params: [args.walletAddress, 'latest'],
        },
        args.signal,
        args.chainId,
    ).catch(() => null)
    return nativeBalance(result) ?? inventory.nativeBalance
}

function zeroPrices(addresses: Iterable<string>) {
    return new Map(
        [...addresses].flatMap((value) => {
            const address = normalizeAddress(value)
            return address ? [[address, '0'] as const] : []
        }),
    )
}

async function scopedInventory(
    args: GetWalletTokensArgs,
): Promise<WalletTokenInventory> {
    if (args.inventory) {
        const [metadata, resolvedNativeBalance] = await Promise.all([
            completeMetadata(args.inventory, args),
            completeNativeBalance(args.inventory, args),
        ])
        return {
            ...args.inventory,
            nativeBalance: resolvedNativeBalance,
            metadata,
            prices: zeroPrices(args.inventory.balances.keys()),
            nativePriceUSD: '0',
        }
    }

    const [balances, nativeResult] = await Promise.all([
        getAlchemyTokenBalancesPaginated({
            chainId: args.chainId,
            walletAddress: args.walletAddress,
            signal: args.signal,
        }),
        alchemyRpc(
            {
                id: 'native-wallet-balance',
                jsonrpc: '2.0',
                method: 'eth_getBalance',
                params: [args.walletAddress, 'latest'],
            },
            args.signal,
            args.chainId,
        ).catch(() => null),
    ])
    const inventory: WalletTokenInventory = {
        ...balances,
        nativeBalance: nativeBalance(nativeResult) ?? balances.nativeBalance,
        metadata: new Map(),
        prices: zeroPrices(balances.balances.keys()),
        nativePriceUSD: '0',
        source: 'alchemy-portfolio',
    }
    inventory.metadata = await completeMetadata(inventory, args)
    return inventory
}

export async function getWalletTokens(
    args: GetWalletTokensArgs,
): ReturnType<typeof baseGetWalletTokens> {
    if (!usesShapeShiftDexScreenerPricing()) {
        return baseGetWalletTokens(args)
    }

    const inventory = await scopedInventory(args)
    const controller = new AbortController()
    controller.abort(new DOMException(
        'Wallet prices are resolved after balance discovery.',
        'AbortError',
    ))
    try {
        return await baseGetWalletTokens({
            ...args,
            inventory,
            signal: controller.signal,
        })
    } finally {
        // Scoped placeholder prices must never leak into another API workflow.
        clearWalletTokenCacheForTest()
    }
}
