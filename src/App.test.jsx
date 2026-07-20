import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')
const primaryActionSource = readFileSync(
    new URL('./features/swap/components/SwapPrimaryAction.jsx', import.meta.url),
    'utf8',
)
const tokenCatalogSource = readFileSync(
    new URL('./features/tokens/hooks/useTokenCatalogController.js', import.meta.url),
    'utf8',
)
const swapViewModelSource = readFileSync(
    new URL('./features/swap/model/swapViewModel.js', import.meta.url),
    'utf8',
)
const frontendSources = [
    appSource,
    primaryActionSource,
    tokenCatalogSource,
    swapViewModelSource,
    readFileSync(new URL('./swapConfig.js', import.meta.url), 'utf8'),
    readFileSync(new URL('./features/cross-chain/services/crossChainRoutes.js', import.meta.url), 'utf8'),
].join('\n')

describe('App cross-chain structure', () => {
    it('uses the normal swap form without the obsolete route panel or manual route CTA', () => {
        expect(frontendSources).not.toContain('CrossChainRoutePanel')
        expect(frontendSources).not.toContain('Find routes')
        expect(frontendSources).not.toContain('Cross-chain swap</')
        expect(primaryActionSource.match(/'primary-action',/g)).toHaveLength(1)
    })

    it('does not expose provider secrets through frontend environment variables', () => {
        expect(frontendSources).not.toMatch(/VITE_(?:RELAY|ACROSS|DEBRIDGE|CHAINFLIP|ZERO_X).*(?:KEY|SECRET)/)
        expect(frontendSources).not.toMatch(/(?:apiKey|secretKey)\s*:/)
    })

    it('renders only normalized cross-chain costs rather than Relay response fields', () => {
        expect(frontendSources).not.toMatch(/relayerService|relayerGas|expandedPriceImpact/)
        expect(frontendSources).not.toMatch(/sellFiatValue\s*-\s*buyFiatValue|buyFiatValue\s*-\s*sellFiatValue/)
    })

    it('requests a selected-chain catalog when the all-chain preload has no matching rows', () => {
        expect(tokenCatalogSource).toContain('preloadedHasSelectedRankedTokens')
        expect(tokenCatalogSource).toContain('shouldFetchSelectedCatalog')
        expect(tokenCatalogSource).toMatch(/enabled:\s*shouldFetchSelectedCatalog/)
        expect(tokenCatalogSource).toMatch(/Number\(token\.chainId\) === Number\(discoveryChainId\)/)
    })
})
