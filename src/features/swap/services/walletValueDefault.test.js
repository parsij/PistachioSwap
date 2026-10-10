import { expect, it } from 'vitest'
import { highestValueWalletChain, nativeSwapInput } from './walletValueDefault.js'
const token = (chainId, n, valueUSD, extra = {}) => ({ chainId, address: '0x' + String(n).padStart(40, '0'),
    balance: '1', valueUSD, recognitionStatus: 'established', recognitionReasons: ['curated-official-contract'],
    visibility: 'primary', priceConfidence: 'trusted', includeInPortfolioValue: true, ...extra })
it('sums all valued holdings on each network instead of using the biggest token or raw quantities', () => {
    expect(highestValueWalletChain([token(1, 1, '100', { balance: '100000' }), token(8453, 2, '60'), token(8453, 3, '60')])).toBe(8453)
    expect(nativeSwapInput(8453)).toMatchObject({ chainId: 8453, isNative: true, symbol: 'ETH' })
})
it('excludes spam, hidden, unsafe, unpriced, unsupported and zero balance tokens', () => {
    expect(highestValueWalletChain([token(1, 1, '5'), token(56, 2, '999', { possibleSpam: true }),
        token(56, 3, '999', { visibility: 'hidden' }), token(56, 4, '999', { securityStatus: 'blocked' }),
        token(56, 5, '999', { priceConfidence: 'untrusted' }), token(56, 6, null),
        token(999999, 7, '999'), token(56, 8, '999', { balance: '0' })])).toBe(1)
})
it('uses exact decimal sums, deduplicates chain/address records and resolves ties deterministically', () => {
    expect(highestValueWalletChain([token(56, 1, '0.1'), token(56, 2, '0.2'), token(1, 3, '0.30000000000000000001')])).toBe(1)
    const duplicate = token(56, 1, '10')
    expect(highestValueWalletChain([duplicate, duplicate, token(8453, 2, '15')])).toBe(8453)
    expect(highestValueWalletChain([token(56, 1, '10'), token(1, 2, '10')])).toBe(1)
})
it('falls back to Ethereum when no usable dollar values exist', () => {
    expect(highestValueWalletChain([])).toBe(1)
    expect(highestValueWalletChain([token(56, 1, null)])).toBe(1)
})
