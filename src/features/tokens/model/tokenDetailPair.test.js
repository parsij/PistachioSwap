import { expect, it } from 'vitest'
import { tokenDetailSellToken } from './tokenDetailPair.js'

it.each([[8453, 'ETH'], [137, 'POL'], [43114, 'AVAX'], [56, 'BNB']])('pairs token details on chain %s with its native %s', (chainId, symbol) => {
    const token = { chainId, address: '0x1111111111111111111111111111111111111111' }
    expect(tokenDetailSellToken(token, [])).toMatchObject({ chainId, symbol, isNative: true })
})
it('preserves canonical native balances and prices', () => {
    const native = { chainId: 8453, address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', balance: '2', priceUSD: '3000' }
    expect(tokenDetailSellToken({ chainId: 8453 }, [native])).toBe(native)
})
it('does not pair a native token with itself', () => {
    expect(tokenDetailSellToken({ chainId: 56, isNative: true }, [])).toBeNull()
})
