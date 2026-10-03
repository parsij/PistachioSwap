import React from 'react'
import { createRoot } from 'react-dom/client'
import PortfolioPage from '../../../src/features/portfolio/components/PortfolioPage.jsx'
import WalletConnectionButton from '../../../src/features/wallet/components/WalletConnectionButton.jsx'
import { createCssVariables } from '../../../src/swapConfig.js'
import '../../../src/index.css'
import '../../../src/features/wallet/components/wallet/walletAccountMotion.css'

// Explicit test-only balances; no wallet provider, signing, or transaction is used.
const token = {
    chainId: 56, address: '0x0000000000000000000000000000000000000000',
    name: 'BNB', symbol: 'BNB', decimals: 18, isNative: true,
    balance: '0.001', formattedBalance: '0.001', rawBalance: '1000000000000000',
    valueUSD: '0.34', trustedPriceUSD: '340', priceConfidence: 'trusted',
    recognitionStatus: 'established', recognitionReasons: ['native-token'],
    classificationTier: 'established', securityStatus: 'trusted', possibleSpam: false,
    visibility: 'primary', includeInPortfolioValue: true,
}
const wallet = {
    walletState: { isConnected: true, address: '0x1111111111111111111111111111111111111111', chainId: 56 },
    walletTokens: [token], nativeToken: token, nativeBalance: { formatted: '0.001', value: 1000000000000000n },
    settings: { hideUnknownTokens: true, hideSmallBalances: false }, selectedTokens: [], onRefetch: async () => {},
}
createRoot(document.getElementById('root')).render(
    <main className="app-shell" style={createCssVariables()}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 72, padding: '0 24px' }}>
            <strong>PistachioSwap</strong><WalletConnectionButton {...wallet} />
        </header>
        <PortfolioPage wallet={wallet} />
    </main>,
)
