import { describe, expect, it } from 'vitest'

import { auditMarketCatalogPayload } from '../src/diagnostics/market-catalog-audit.js'

describe('market catalog audit', () => {
    it('reports section, evidence, logo, and count defects by exact identity', () => {
        const address = '0x0000000000000000000000000000000000000001'
        const [ethereum] = auditMarketCatalogPayload({
            commonCount: 0,
            tokens: [{ chainId: 1, address, decimals: 18, volume24hUsd: 1, liquidityUsd: 1 }],
            commonTokens: [{
                chainId: 1, address, decimals: 18, officialAsset: true,
                logoCandidates: ['/icons/token-fallback.svg'],
            }],
        })
        expect(ethereum).toMatchObject({
            missingRequiredClassificationFields: 1,
            majorCuratedTokensMissingTrustedLogos: 1,
            duplicateCanonicalIdentitiesAcrossSections: 1,
            commonCountMismatch: true,
            rankedTokensWithoutExactTrustedRecognition: 1,
        })
    })
})
