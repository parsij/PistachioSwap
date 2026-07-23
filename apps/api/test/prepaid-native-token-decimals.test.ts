import { describe, expect, it } from 'vitest'

import { NATIVE_TOKEN_ADDRESS } from '../src/lib/address.js'
import { prepaidChainClientInternals } from '../src/gas-assist/prepaid/chain-client.js'

describe('prepaid native token decimals', () => {
    it('treats the zero-address native BNB sentinel as 18 decimals', () => {
        expect(prepaidChainClientInternals.nativeTokenDecimals(
            NATIVE_TOKEN_ADDRESS,
        )).toBe(18)
    })

    it('does not treat an ERC-20 token as native BNB', () => {
        expect(prepaidChainClientInternals.nativeTokenDecimals(
            '0x21caef8a43163eea865baee23b9c2e327696a3bf',
        )).toBeNull()
    })
})
