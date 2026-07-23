// @vitest-environment jsdom

import React from 'react'
import {
    cleanup,
    render,
    screen,
    fireEvent,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    activity: [],
    disconnect: vi.fn(),
    publicClient: {
        getGasPrice: vi.fn(),
        estimateGas: vi.fn(),
        estimateContractGas: vi.fn(),
        simulateContract: vi.fn(),
        waitForTransactionReceipt: vi.fn(),
    },
}))

vi.mock('wagmi', () => ({
    useDisconnect: () => ({ mutate: mocks.disconnect }),
    usePublicClient: () => mocks.publicClient,
    useSendTransaction: () => ({ mutateAsync: vi.fn() }),
    useWriteContract: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('../../hooks/useWalletActivity.js', () => ({
    useWalletActivity: () => ({
        items: mocks.activity,
        loading: false,
        error: null,
    }),
}))

import WalletAccountDialog from './WalletAccountDialog.jsx'

const account = '0x0000000000000000000000000000000000000001'
const recipient = '0x0000000000000000000000000000000000000002'
const native = {
    chainId: 56,
    address: '0x0000000000000000000000000000000000000000',
    isNative: true,
    name: 'BNB',
    symbol: 'BNB',
    decimals: 18,
    rawBalance: '1000000000000000000',
    balance: '1',
    valueUSD: '600',
    trustedPriceUSD: '600',
    recognitionStatus: 'established',
    recognitionReasons: ['native-token'],
    possibleSpam: false,
    securityStatus: 'trusted',
    priceConfidence: 'trusted',
    includeInPortfolioValue: true,
    visibility: 'primary',
    logoURI: '/icons/bnb.svg',
}
const usdt = {
    chainId: 56,
    address: '0x0000000000000000000000000000000000000101',
    isNative: false,
    name: 'Tether USD',
    symbol: 'USDT',
    decimals: 18,
    rawBalance: '10000000000000000000',
    balance: '10',
    valueUSD: '10',
    trustedPriceUSD: '1',
    recognitionStatus: 'recognized',
    recognitionReasons: ['coingecko-exact-contract'],
    possibleSpam: false,
    verifiedContract: true,
    securityStatus: 'low',
    priceConfidence: 'trusted',
    includeInPortfolioValue: true,
    visibility: 'primary',
}
const xaut = {
    ...usdt,
    address: '0x0000000000000000000000000000000000000102',
    name: 'Tether Gold',
    symbol: 'XAUt',
    rawBalance: '1000000',
    balance: '1',
    valueUSD: '2400',
    trustedPriceUSD: '2400',
    marketPriceUSD: null,
    recognitionStatus: 'established',
    recognitionReasons: ['curated-official-contract'],
    priceConfidence: 'trusted',
    officialAsset: true,
}
const scam = {
    ...usdt,
    address: '0x0000000000000000000000000000000000000666',
    name: 'RETURN TO MEMES',
    symbol: 'RET',
    valueUSD: null,
    trustedPriceUSD: null,
    marketPriceUSD: '447000',
    recognitionStatus: 'unverified',
    recognitionReasons: ['market-catalog-only'],
    possibleSpam: false,
    verifiedContract: false,
    securityStatus: 'caution',
    priceConfidence: 'untrusted',
    includeInPortfolioValue: false,
    visibility: 'hidden',
}
const secantX = {
    ...scam,
    address: '0x0000000000000000000000000000000000000eca',
    name: 'SecantX AI',
    symbol: 'SECA',
    marketPriceUSD: '447463.12',
    verifiedContract: true,
    securityStatus: 'low',
    recognitionReasons: ['moralis-verified-contract', 'market-catalog-only'],
    visibilityReasons: ['moralis-verified-contract', 'market-catalog-only'],
}

function activity(type, token, hashSuffix, amount = '1') {
    return {
        id: `${type}:${hashSuffix}`,
        walletAddress: account,
        type,
        chainId: 56,
        hash: `0x${hashSuffix.padStart(64, '0')}`,
        timestamp: '2026-07-22T12:00:00.000Z',
        token,
        amount,
        recipient,
    }
}

function renderDialog() {
    return render(<WalletAccountDialog
        open
        onOpenChange={vi.fn()}
        address={account}
        chainId={56}
        nativeBalance={{ value: 1000000000000000000n, formatted: '1' }}
        nativeToken={native}
        walletTokens={[native, usdt, xaut, scam, secantX]}
        settings={{ hideUnknownTokens: true, hideSmallBalances: false }}
        selectedTokens={[]}
        explorerUrl="https://bscscan.com"
        onRefetch={vi.fn()}
    />)
}

describe('WalletAccountDialog trust filtering', () => {
    afterEach(() => {
        cleanup()
        mocks.activity = []
        vi.clearAllMocks()
    })

    it('renders trusted portfolio value and recent activity without scam-token leaks', () => {
        mocks.activity = [
            activity('received', scam, '666', '1'),
            activity('sent', usdt, '101', '5'),
            activity('received', xaut, '102', '0.25'),
            activity('received', native, '103', '0.1'),
            activity('approved', usdt, '104', '10'),
        ]

        renderDialog()

        expect(screen.getByText('$3,010.00')).toBeTruthy()
        expect(document.body.textContent).not.toContain('$447,526.72')
        expect(document.body.textContent).not.toContain('$447,463.12')
        expect(screen.queryByText('RETURN TO MEMES')).toBeNull()
        expect(screen.queryByText('SecantX AI')).toBeNull()
        expect(document.body.textContent).not.toContain('SECA')
        expect(screen.getByText('5 USDT to 0x00000…00002')).toBeTruthy()
        expect(screen.getByText('0.25 XAUt')).toBeTruthy()
        expect(screen.getByText('0.1 BNB')).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: /View all activity/ }))
        expect(screen.getByText('4 confirmed transactions')).toBeTruthy()
        expect(screen.getByText('10 USDT')).toBeTruthy()
        expect(screen.queryByText('RETURN TO MEMES')).toBeNull()
    })
})
