import { describe, expect, it } from 'vitest'

import {
    normalizeUnchainedAccount,
} from '../src/providers/unchained/wallet-tokens.js'

const wallet = '0x1000000000000000000000000000000000000042'
const token = '0x2000000000000000000000000000000000000042'

describe('Unchained account normalization', () => {
    it('normalizes native and ERC-20 balances', () => {
        expect(normalizeUnchainedAccount({
            balance: '1000000000000000000',
            unconfirmedBalance: '0',
            nonce: 1,
            pubkey: wallet.toUpperCase(),
            tokens: [
                {
                    balance: '2500000',
                    contract: token.toUpperCase(),
                    decimals: 6,
                    name: 'USD Coin',
                    symbol: 'USDC',
                    type: 'ERC20',
                },
            ],
        })).toEqual({
            balance: 1000000000000000000n,
            pubkey: wallet,
            tokens: [
                {
                    balance: 2500000n,
                    contract: token,
                    decimals: 6,
                    name: 'USD Coin',
                    symbol: 'USDC',
                },
            ],
        })
    })

    it('drops malformed token rows without rejecting the account', () => {
        const account = normalizeUnchainedAccount({
            balance: '0',
            pubkey: wallet,
            tokens: [
                {
                    balance: '-1',
                    contract: token,
                    decimals: 18,
                    name: 'Bad balance',
                    symbol: 'BAD',
                },
                {
                    balance: '1',
                    contract: 'not-an-address',
                    decimals: 18,
                    name: 'Bad address',
                    symbol: 'BAD',
                },
            ],
        })
        expect(account).toEqual({
            balance: 0n,
            pubkey: wallet,
            tokens: [],
        })
    })

    it('rejects malformed account payloads', () => {
        expect(normalizeUnchainedAccount(null)).toBeNull()
        expect(normalizeUnchainedAccount({
            balance: 'not-a-balance',
            pubkey: wallet,
            tokens: [],
        })).toBeNull()
        expect(normalizeUnchainedAccount({
            balance: '0',
            pubkey: 'not-an-address',
            tokens: [],
        })).toBeNull()
    })
})
