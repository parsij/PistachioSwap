import { readFile, writeFile } from 'node:fs/promises'

async function patch(path, mutator) {
  const before = await readFile(path, 'utf8')
  const after = mutator(before)
  if (after === before) throw new Error(`No change made to ${path}`)
  await writeFile(path, after)
}

function once(text, needle, replacement, path) {
  const count = text.split(needle).length - 1
  if (count !== 1) throw new Error(`${path}: expected one match, got ${count}`)
  return text.replace(needle, replacement)
}

await patch('apps/api/src/compliance/service.ts', (input) => {
  let out = once(input,
    "        enabled: boolEnv('COMPLIANCE_ENABLED', true),\n",
    "        enabled: boolEnv('COMPLIANCE_ENABLED', process.env.NODE_ENV !== 'test'),\n",
    'compliance test default')
  out = once(out,
    "                'user-agent': 'PistachioSwap-OFAC-Screener/1.0 compliance@pistachioswap.com',\n",
    "                'user-agent': 'PistachioSwap-OFAC-Screener/1.0',\n",
    'compliance user agent')
  return out
})

await patch('apps/api/src/modules/compliance.ts', (input) => {
  let out = once(input,
    "    const allowed = new Set(['walletAddress', 'chainId'])\n",
    "    const allowed = new Set(['walletAddress', 'chainId', 'purpose'])\n",
    'compliance body fields')
  out = once(out,
    "    const chainId = body.chainId == null ? null : Number(body.chainId)\n    if (!walletAddress || (chainId != null && (!Number.isSafeInteger(chainId) || chainId <= 0))) {\n",
    "    const chainId = body.chainId == null ? null : Number(body.chainId)\n    const purpose = body.purpose == null ? 'background' : String(body.purpose)\n    if (!['background', 'transaction'].includes(purpose)) {\n        throw new ComplianceError('COMPLIANCE_INVALID_REQUEST', 'The compliance purpose is invalid.', 400)\n    }\n    if (!walletAddress || (chainId != null && (!Number.isSafeInteger(chainId) || chainId <= 0))) {\n",
    'compliance purpose validation')
  out = once(out,
    "    return { walletAddress, chainId }\n",
    "    return { walletAddress, chainId, purpose }\n",
    'compliance body return')
  out = once(out,
    "                    action: 'client-screen',\n",
    "                    action: body.purpose === 'transaction' ? 'client-transaction-gate' : 'client-screen',\n",
    'compliance action')
  out = once(out,
    "                    persist: false,\n                    useExternalProvider: true,\n",
    "                    persist: body.purpose === 'transaction',\n                    useExternalProvider: true,\n",
    'compliance persistence')
  return out
})

await patch('src/features/compliance/services/compliance.js', (input) => {
  let out = once(input,
    "export async function screenComplianceAccess({ endpoint, walletAddress, chainId, signal }) {\n",
    "export async function screenComplianceAccess({ endpoint, walletAddress, chainId, purpose = 'background', signal }) {\n",
    'frontend compliance args')
  out = once(out,
    "        body: JSON.stringify({ walletAddress, chainId }),\n",
    "        body: JSON.stringify({ walletAddress, chainId, purpose }),\n",
    'frontend compliance body')
  return out
})

await patch('src/features/compliance/hooks/useComplianceAccess.js', (input) => {
  let out = once(input,
    "    const check = useCallback(async ({ force = false } = {}) => {\n",
    "    const check = useCallback(async ({ force = false, purpose = 'background' } = {}) => {\n",
    'compliance hook check args')
  out = once(out,
    "                chainId,\n                signal: controller.signal,\n",
    "                chainId,\n                purpose,\n                signal: controller.signal,\n",
    'compliance hook purpose')
  out = once(out,
    "        const result = await check({ force: true })\n",
    "        const result = await check({ force: true, purpose: 'transaction' })\n",
    'compliance transaction persistence')
  return out
})

await patch('apps/api/src/app.ts', (input) => {
  let out = once(input,
    "import { gasAssistProxyRoutes } from './modules/gas-assist-proxy.js'\n",
    "import { gasAssistProxyRoutes } from './modules/gas-assist-proxy.js'\nimport { complianceRoutes } from './modules/compliance.js'\nimport { getComplianceService } from './compliance/service.js'\n",
    'app.ts import')
  out = once(out,
    "    '/v1/cross-chain',\n",
    "    '/v1/cross-chain',\n    '/v1/compliance',\n",
    'app.ts sensitive')
  out = once(out,
    "    app.register(gasAssistProxyRoutes, { prefix })\n",
    "    app.register(gasAssistProxyRoutes, { prefix })\n    app.register(complianceRoutes, { prefix })\n",
    'app.ts routes')
  out = once(out,
    "        if (process.env.NODE_ENV !== 'test') {\n            marketCatalogService.setPersistenceWarningHandler",
    "        if (process.env.NODE_ENV !== 'test') {\n            if (getComplianceService().status().enabled) {\n                try {\n                    await getComplianceService().refreshOfacSnapshot()\n                } catch (error) {\n                    app.log.error({ subsystem: 'compliance', err: error }, 'Initial OFAC list refresh failed; transaction screening will fail closed')\n                }\n            }\n            marketCatalogService.setPersistenceWarningHandler",
    'app.ts startup')
  return out
})

await patch('apps/api/src/features/quotes/routes/quote-routes.ts', (input) => {
  let out = once(input,
    "import { getSafeError } from '../../../lib/errors.js'\n",
    "import { getSafeError } from '../../../lib/errors.js'\nimport { ComplianceError, complianceRequestGeo, getComplianceService } from '../../../compliance/service.js'\n",
    'quote imports')
  out = once(out,
    "        const normalized = validateQuoteRequest(request.body)\n        const selection = await selectQuotes(normalized, controller.signal)\n",
    "        const normalized = validateQuoteRequest(request.body)\n        const location = complianceRequestGeo(request.headers as Record<string, unknown>)\n        await getComplianceService().enforce({\n            walletAddress: normalized.takerAddress,\n            chainId: normalized.chainId,\n            action: 'same-chain-quote',\n            countryCode: location.countryCode,\n            regionCode: location.regionCode,\n            clientIp: request.ip,\n            persist: false,\n            useExternalProvider: true,\n        })\n        const selection = await selectQuotes(normalized, controller.signal)\n",
    'quote enforcement')
  out = once(out,
    "        const safe = getSafeError(error)\n",
    "        if (error instanceof ComplianceError) {\n            return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } })\n        }\n        const safe = getSafeError(error)\n",
    'quote error')
  return out
})

await patch('apps/api/src/modules/cross-chain.ts', (input) => {
  let out = once(input,
    "import { getApiConfig } from '../config.js'\n",
    "import { getApiConfig } from '../config.js'\nimport { ComplianceError, complianceRequestGeo, getComplianceService } from '../compliance/service.js'\n",
    'cross imports')
  out = once(out,
    "            try {\n                const result = await service.quote(normalized, abortSignal(request))\n",
    "            try {\n                const location = complianceRequestGeo(request.headers as Record<string, unknown>)\n                await getComplianceService().enforce({\n                    walletAddress: normalized.ownerAddress,\n                    chainId: normalized.sourceAsset.chainId,\n                    action: 'cross-chain-quote-owner',\n                    countryCode: location.countryCode,\n                    regionCode: location.regionCode,\n                    clientIp: request.ip,\n                    persist: false,\n                    useExternalProvider: true,\n                })\n                if (normalized.recipient !== normalized.ownerAddress) {\n                    await getComplianceService().enforce({\n                        walletAddress: normalized.recipient,\n                        chainId: normalized.destinationAsset.chainId,\n                        action: 'cross-chain-quote-recipient',\n                        countryCode: location.countryCode,\n                        regionCode: location.regionCode,\n                        clientIp: request.ip,\n                        persist: false,\n                        useExternalProvider: true,\n                    })\n                }\n                const result = await service.quote(normalized, abortSignal(request))\n",
    'cross quote')
  out = once(out,
    "                    const session = await auth.authenticate(request.headers.authorization)\n                    const idempotencyHeader = request.headers['idempotency-key']\n",
    "                    const session = await auth.authenticate(request.headers.authorization)\n                    const location = complianceRequestGeo(request.headers as Record<string, unknown>)\n                    await getComplianceService().enforce({\n                        walletAddress: session.walletAddress,\n                        chainId: session.chainId,\n                        action: 'cross-chain-sponsorship-prepare',\n                        countryCode: location.countryCode,\n                        regionCode: location.regionCode,\n                        clientIp: request.ip,\n                        persist: true,\n                        useExternalProvider: true,\n                    })\n                    const idempotencyHeader = request.headers['idempotency-key']\n",
    'cross sponsored prepare')
  out = once(out,
    "    const explicitStatus =\n",
    "    if (error instanceof ComplianceError) {\n        return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } })\n    }\n    const explicitStatus =\n",
    'cross error')
  return out
})

await patch('apps/api/src/modules/gas-assist-proxy.ts', (input) => {
  return once(input,
    "    const authorization = request.headers.authorization\n",
    "    const country = request.headers['cf-ipcountry']\n    if (typeof country === 'string' && /^[A-Za-z]{2}$/.test(country)) {\n        headers.set('x-pistachio-client-country', country.toUpperCase())\n    }\n    const region = request.headers['cf-region-code']\n    if (typeof region === 'string' && /^[A-Za-z0-9-]{1,16}$/.test(region)) {\n        headers.set('x-pistachio-client-region', region.toUpperCase())\n    }\n\n    const authorization = request.headers.authorization\n",
    'gas proxy geo')
})

await patch('src/features/swap/hooks/useSwapController.js', (input) => {
  let out = once(input,
    "import { useSwapPrimaryAction } from './useSwapPrimaryAction.js'\n",
    "import { useSwapPrimaryAction } from './useSwapPrimaryAction.js'\nimport { useComplianceAccess } from '../../compliance/hooks/useComplianceAccess.js'\n",
    'controller import')
  out = once(out,
    "    const walletState = useWalletState(swapChainId)\n    const [swapSettings, setSwapSettings] = useSwapSettings()\n",
    "    const walletState = useWalletState(swapChainId)\n    const compliance = useComplianceAccess({\n        endpoint: quoteConfig.endpoint,\n        walletAddress: walletState.address,\n        chainId: swapChainId,\n    })\n    const [swapSettings, setSwapSettings] = useSwapSettings()\n",
    'controller hook')
  out = once(out,
    "        diagnostic: logSwapDiagnostic,\n    })\n\n    const quoteModeDiagnosticRef",
    "        diagnostic: logSwapDiagnostic,\n        compliance,\n    })\n\n    const quoteModeDiagnosticRef",
    'controller primary config')
  return out
})

await patch('src/features/swap/hooks/useSwapPrimaryAction.js', (input) => {
  let out = once(input,
    "        setReviewOperation, setVisibleStatus, confirmExecution, diagnostic,\n",
    "        setReviewOperation, setVisibleStatus, confirmExecution, diagnostic, compliance,\n",
    'primary destructure')
  out = once(out,
    "        if (transactionStatus === 'pending' || transactionStatus === 'submitted') {\n",
    "        try {\n            await compliance?.ensureAllowed?.()\n        } catch (error) {\n            const unavailable = error?.code === 'COMPLIANCE_UNAVAILABLE' || Number(error?.status) >= 500\n            setVisibleStatus(unavailable\n                ? 'Compliance screening is temporarily unavailable. Please try again later.'\n                : 'This wallet cannot use PistachioSwap transaction services.')\n            diagnostic('primary-action.blocked', { reason: unavailable ? 'compliance-unavailable' : 'compliance-restricted' }, 'warn')\n            return\n        }\n        if (transactionStatus === 'pending' || transactionStatus === 'submitted') {\n",
    'primary gate')
  out = once(out,
    "        diagnostic('review.confirm.clicked', {\n",
    "        try {\n            await compliance?.ensureAllowed?.()\n        } catch (error) {\n            const unavailable = error?.code === 'COMPLIANCE_UNAVAILABLE' || Number(error?.status) >= 500\n            const message = unavailable\n                ? 'Compliance screening is temporarily unavailable. Please try again later.'\n                : 'This wallet cannot use PistachioSwap transaction services.'\n            setVisibleStatus(message)\n            setReviewError(message)\n            diagnostic('review.confirm.blocked', { reason: unavailable ? 'compliance-unavailable' : 'compliance-restricted' }, 'warn')\n            return null\n        }\n        diagnostic('review.confirm.clicked', {\n",
    'confirm gate')
  return out
})

for (const path of ['apps/api/.env.example', 'apps/api/.env.production.example']) {
  await patch(path, (input) => input + `\n# OFAC/sanctions screening. Official list matching is exact-address only.\nCOMPLIANCE_ENABLED=true\nCOMPLIANCE_FAIL_CLOSED=true\n# Enable only when the origin accepts these headers exclusively from Cloudflare.\nCOMPLIANCE_TRUST_CLOUDFLARE_GEO=false\nCOMPLIANCE_BLOCKED_COUNTRY_CODES=CU,IR,KP\n# Optional entries formatted COUNTRY:REGION and reviewed by counsel. Do not block all of Ukraine.\nCOMPLIANCE_BLOCKED_REGION_CODES=\nCOMPLIANCE_SCREEN_CACHE_MS=300000\nOFAC_SDN_URL=https://sanctionslistservice.ofac.treas.gov/api/download/sdn.xml\nOFAC_CONSOLIDATED_URL=https://sanctionslistservice.ofac.treas.gov/api/download/consolidated.xml\nOFAC_REFRESH_INTERVAL_MS=900000\nOFAC_MAX_LIST_AGE_MS=86400000\n# Optional third-party sanctions exposure screening. Store auth only in the server env.\nTRM_SANCTIONS_ENABLED=false\nTRM_SANCTIONS_URL=https://api.trmlabs.com/public/v1/sanctions/screening\nTRM_SANCTIONS_AUTHORIZATION=\n`)
}

await patch('TERMS.md', (input) => once(input,
  "## 16. Intellectual property and source license\n",
  `## 16. Sanctions and restricted access\n\nPistachioSwap may screen public wallet addresses and request location signals against applicable sanctions restrictions, official government sanctions data, and configured blockchain-intelligence providers. The hosted website, APIs, routing, Gas Assist, transaction preparation, and other state-changing services may be refused or disabled when a request is prohibited, presents a sanctions match, or cannot be screened reliably.\n\nPistachioSwap does not control public blockchains or independent smart contracts and cannot prevent a user from interacting with them through other software. A restriction by the hosted Service is not a representation about the legal status of an address, asset, person, or transaction outside the specific Service decision. Screening can produce false positives or incomplete results. Users who believe a restriction is erroneous may contact legal@pistachioswap.com without sending a private key, recovery phrase, or signed raw transaction.\n\nSanctions programs and geographic restrictions change. Availability from a location or to a wallet at one time does not guarantee future availability.\n\n## 17. Intellectual property and source license\n`,
  'terms sanctions').replaceAll('## 17. Feedback and contributions', '## 18. Feedback and contributions')
    .replaceAll('## 18. Privacy', '## 19. Privacy')
    .replaceAll('## 19. Availability, changes, suspension, and termination', '## 20. Availability, changes, suspension, and termination')
    .replaceAll('## 20. Disclaimers', '## 21. Disclaimers')
    .replaceAll('## 21. Limitation of liability', '## 22. Limitation of liability')
    .replaceAll('## 22. Indemnification', '## 23. Indemnification')
    .replaceAll('## 23. Governing law and dispute venue', '## 24. Governing law and dispute venue')
    .replaceAll('## 24. Changes to these Terms', '## 25. Changes to these Terms')
    .replaceAll('## 25. General terms', '## 26. General terms')
    .replaceAll('## 26. Contact', '## 27. Contact'))

await patch('PRIVACY.md', (input) => {
  let out = once(input,
    "- approximate location inferred by infrastructure or security providers from an IP address; and\n",
    "- approximate location inferred by infrastructure or security providers from an IP address;\n- sanctions-screening decisions, the version/hash of sanctions data used, and limited compliance case evidence when a transaction is restricted; and\n",
    'privacy data')
  out = once(out,
    "- comply with applicable law and establish, exercise, or defend legal claims.\n",
    "- screen public wallet addresses and transaction requests for sanctions restrictions, reject prohibited hosted-service activity, document compliance decisions, and make legally required reports; and\n- comply with applicable law and establish, exercise, or defend legal claims.\n",
    'privacy purpose')
  out = once(out,
    "- **Security/abuse records:** may be kept while a threat, limit, investigation, or legal need remains active.\n",
    "- **Security/abuse records:** may be kept while a threat, limit, investigation, or legal need remains active.\n- **Sanctions screening records:** ordinary checks are designed to store only compact wallet/chain/action, coarse location, decision, sanctions-data version, transaction reference, and time fields. Raw signed transactions and identity documents are not collected merely for routine sanctions screening. When a request is actually blocked or escalated, a separate case record may preserve the client IP and limited evidence needed for legal review/reporting. Records required by OFAC or other law may be retained for the legally required period, which is currently up to 10 years for records subject to OFAC's recordkeeping rule.\n",
    'privacy retention')
  return out
})

console.log('Applied OFAC compliance integration patches.')
