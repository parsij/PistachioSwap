import { NATIVE_TOKEN_ADDRESS, normalizeAddress } from './lib/address.js'

const ALLOWED_CHAINS = new Set([56])
const warnedInvalidAddressEntries = new Set<string>()

function readInteger(
    name: string,
    fallback: number,
    minimum = 0,
) {
    const parsed = Number(process.env[name])
    return Number.isInteger(parsed) && parsed >= minimum
        ? parsed
        : fallback
}

function readConfiguredNumber(
    name: string,
    fallback: number,
    minimum: number,
    maximum = Number.MAX_SAFE_INTEGER,
) {
    const raw = process.env[name]?.trim()
    if (!raw) return fallback

    const parsed = Number(raw)
    if (
        !Number.isFinite(parsed) ||
        parsed < minimum ||
        parsed > maximum
    ) {
        throw new Error(
            `${name} must be a number between ${minimum} and ${maximum}.`,
        )
    }

    return parsed
}

function readConfiguredInteger(
    name: string,
    fallback: number,
    minimum: number,
    maximum = Number.MAX_SAFE_INTEGER,
) {
    const value = readConfiguredNumber(name, fallback, minimum, maximum)
    if (!Number.isInteger(value)) {
        throw new Error(`${name} must be an integer.`)
    }
    return value
}

function readAddressSet(name: string) {
    const values = new Set<string>()
    for (const raw of (process.env[name] ?? '').split(',')) {
        if (!raw.trim()) continue
        const address = normalizeAddress(raw)
        if (!address) throw new Error(`${name} contains an invalid address.`)
        values.add(address)
    }
    return values
}

function readOptionalAddressSet(name: string) {
    const values = new Set<string>()
    const entries = (process.env[name] ?? '').split(',')

    for (let index = 0; index < entries.length; index += 1) {
        const raw = entries[index]
        if (!raw.trim()) continue
        const address = normalizeAddress(raw)
        if (address) {
            values.add(address)
            continue
        }

        const warningKey = `${name}:${index}`
        if (!warnedInvalidAddressEntries.has(warningKey)) {
            warnedInvalidAddressEntries.add(warningKey)
            console.warn(`${name} ignored an invalid address entry.`)
        }
    }

    return values
}

function readBoolean(name: string, fallback: boolean) {
    const value = process.env[name]?.trim().toLowerCase()
    if (value === 'true') return true
    if (value === 'false') return false
    return fallback
}

function readUrl(
    name: string,
    fallback: string,
    allowedHosts: string[],
    allowLocalhost = false,
) {
    const raw = process.env[name]?.trim() || fallback
    const url = new URL(raw)
    const local = ['localhost', '127.0.0.1'].includes(url.hostname)

    if (
        url.username ||
        url.password ||
        (url.protocol !== 'https:' && !(allowLocalhost && local)) ||
        (!local && !allowedHosts.includes(url.hostname))
    ) {
        throw new Error(`${name} is not an allowed provider URL.`)
    }

    return url.toString().replace(/\/+$/, '')
}

function getAlchemyRpcUrl() {
    const explicit = process.env.ALCHEMY_BSC_RPC_URL?.trim()

    if (explicit) {
        return readUrl(
            'ALCHEMY_BSC_RPC_URL',
            explicit,
            ['bnb-mainnet.g.alchemy.com'],
            true,
        )
    }

    const key = process.env.ALCHEMY_API_KEY?.trim()
    const network =
        process.env.ALCHEMY_NETWORK?.trim() || 'bnb-mainnet'

    return key
        ? `https://${network}.g.alchemy.com/v2/${encodeURIComponent(key)}`
        : null
}

function readRpcUrl(name: string) {
    const raw = process.env[name]?.trim()
    if (!raw) return null

    const url = new URL(raw)
    const local = ['localhost', '127.0.0.1'].includes(url.hostname)

    if (
        url.username ||
        url.password ||
        (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    ) {
        throw new Error(`${name} must be an HTTPS RPC URL.`)
    }

    return url.toString()
}

function readOptionalHttpsUrl(name: string) {
    const raw = process.env[name]?.trim()
    if (!raw) return null
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error(`${name} must be an HTTPS URL without embedded credentials.`)
    }
    return url.toString()
}

function readPositiveDecimal(name: string, fallback: string) {
    const value = process.env[name]?.trim() || fallback
    if (
        !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ||
        /^0(?:\.0+)?$/.test(value)
    ) {
        throw new Error(`${name} must be a positive decimal string.`)
    }
    return value
}

export function getApiConfig() {
    const platformFeeBps = readInteger(
        'PLATFORM_FEE_BPS',
        0,
        0,
    )

    if (platformFeeBps > 1000) {
        throw new Error('PLATFORM_FEE_BPS cannot exceed 1000.')
    }

    return {
        chainId: 56,
        allowedChains: ALLOWED_CHAINS,
        corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        requestTimeoutMs: readInteger(
            'PROVIDER_REQUEST_TIMEOUT_MS',
            10_000,
            1,
        ),
        alchemy: {
            rpcUrl: getAlchemyRpcUrl(),
            apiKey: process.env.ALCHEMY_API_KEY?.trim() || null,
            network:
                process.env.ALCHEMY_NETWORK?.trim() || 'bnb-mainnet',
            metadataTtlMs: readInteger(
                'TOKEN_METADATA_CACHE_TTL_MS',
                86_400_000,
                1,
            ),
            negativeMetadataTtlMs: 30 * 60 * 1000,
            walletTtlMs: Math.min(
                readInteger('WALLET_TOKEN_CACHE_TTL_MS', 30_000, 1),
                30_000,
            ),
            concurrency: 6,
            maxBatchSize: 50,
        },
        dexScreener: {
            baseUrl: readUrl(
                'DEXSCREENER_API_BASE_URL',
                'https://api.dexscreener.com',
                ['api.dexscreener.com'],
            ),
            chainId: 'bsc',
        },
        geckoTerminal: {
            baseUrl: readUrl(
                'GECKOTERMINAL_API_BASE_URL',
                'https://api.geckoterminal.com/api/v2',
                ['api.geckoterminal.com'],
            ),
            network:
                process.env.GECKOTERMINAL_NETWORK?.trim() || 'bsc',
            pageDelayMs: readInteger(
                'GECKOTERMINAL_PAGE_DELAY_MS',
                2_100,
                0,
            ),
            maxPages: 10,
        },
        coinGecko: {
            apiKey:
                process.env.COINGECKO_DEMO_API_KEY?.trim() || null,
            baseUrl: readUrl(
                'COINGECKO_API_BASE_URL',
                'https://api.coingecko.com/api/v3',
                ['api.coingecko.com'],
                true,
            ),
            network:
                process.env.COINGECKO_NETWORK_56?.trim() || 'bsc',
            searchTtlMs: 5 * 60 * 1000,
            tokenTtlMs: 24 * 60 * 60 * 1000,
            negativeTokenTtlMs: 15 * 60 * 1000,
        },
        moralis: {
            enabled: readBoolean('MORALIS_ENABLED', true),
            baseUrl: readUrl(
                'MORALIS_API_BASE_URL',
                'https://deep-index.moralis.io/api/v2.2',
                ['deep-index.moralis.io'],
            ),
            apiKey: process.env.MORALIS_API_KEY?.trim() || null,
            cacheTtlMs: readConfiguredInteger(
                'MORALIS_WALLET_CACHE_TTL_MS',
                300_000,
                1,
            ),
            requestTimeoutMs: readConfiguredInteger(
                'MORALIS_REQUEST_TIMEOUT_MS',
                10_000,
                100,
                60_000,
            ),
        },
        honeypot: {
            enabled: readBoolean('HONEYPOT_ENABLED', true),
            baseUrl: readUrl(
                'HONEYPOT_API_BASE_URL',
                'https://api.honeypot.is',
                ['api.honeypot.is'],
            ),
            apiKey: process.env.HONEYPOT_API_KEY?.trim() || null,
        },
        goPlus: {
            enabled: readBoolean('GOPLUS_ENABLED', false),
            baseUrl: readUrl(
                'GOPLUS_API_BASE_URL',
                'https://api.gopluslabs.io/api/v1',
                ['api.gopluslabs.io'],
            ),
            accessToken: process.env.GOPLUS_ACCESS_TOKEN?.trim() || null,
            batchSize: readConfiguredInteger(
                'GOPLUS_BATCH_SIZE',
                20,
                1,
                20,
            ),
        },
        tokenSecurity: {
            cacheTtlMs: readConfiguredInteger(
                'TOKEN_SECURITY_CACHE_TTL_MS',
                43_200_000,
                1,
            ),
            blockedCacheTtlMs: readConfiguredInteger(
                'TOKEN_SECURITY_BLOCKED_CACHE_TTL_MS',
                86_400_000,
                1,
            ),
            unknownCacheTtlMs: readConfiguredInteger(
                'TOKEN_SECURITY_UNKNOWN_CACHE_TTL_MS',
                3_600_000,
                1,
            ),
            errorCacheTtlMs: readConfiguredInteger(
                'TOKEN_SECURITY_ERROR_CACHE_TTL_MS',
                300_000,
                1,
            ),
            concurrency: readConfiguredInteger(
                'TOKEN_SECURITY_CONCURRENCY',
                4,
                1,
                20,
            ),
            requestTimeoutMs: readConfiguredInteger(
                'TOKEN_SECURITY_REQUEST_TIMEOUT_MS',
                10_000,
                100,
                60_000,
            ),
        },
        market: {
            catalogTtlMs: readConfiguredInteger(
                'ESTABLISHED_TOKEN_CACHE_TTL_MS',
                600_000,
                1,
            ),
            partialRetryMs: readConfiguredInteger(
                'ESTABLISHED_TOKEN_PARTIAL_RETRY_MS',
                60_000,
                1,
            ),
            staleTtlMs: readConfiguredInteger(
                'ESTABLISHED_TOKEN_STALE_TTL_MS',
                86_400_000,
                1,
            ),
            searchTtlMs: readInteger(
                'MARKET_TOKEN_SEARCH_CACHE_TTL_MS',
                300_000,
                1,
            ),
            minimumLiquidityUsd: readConfiguredNumber(
                'ESTABLISHED_TOKEN_MIN_LIQUIDITY_USD',
                100_000,
                0,
            ),
            minimumVolume24hUsd: readConfiguredNumber(
                'ESTABLISHED_TOKEN_MIN_VOLUME_24H_USD',
                25_000,
                0,
            ),
            minimumPoolAgeDays: readConfiguredNumber(
                'ESTABLISHED_TOKEN_MIN_POOL_AGE_DAYS',
                30,
                0,
            ),
            minimumPairCount: readConfiguredInteger(
                'ESTABLISHED_TOKEN_MIN_PAIR_COUNT',
                1,
                1,
            ),
            defaultLimit: readConfiguredInteger(
                'ESTABLISHED_TOKEN_LIMIT',
                100,
                1,
                100,
            ),
            candidateLimit: readConfiguredInteger(
                'ESTABLISHED_CANDIDATE_LIMIT',
                250,
                1,
                1_000,
            ),
            searchLimit: Math.min(
                readInteger('MARKET_TOKEN_SEARCH_LIMIT', 20, 1),
                20,
            ),
            maximumQueryLength: 80,
            wrappedNativeAddress: normalizeAddress(
                process.env.PANCAKESWAP_WRAPPED_NATIVE_ADDRESS_56,
            ) ?? '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
            chainLogoUri: '/icons/bnb.svg',
            blocklist: readAddressSet('ESTABLISHED_TOKEN_BLOCKLIST'),
            snapshotEnabled: readBoolean(
                'ESTABLISHED_TOKEN_SNAPSHOT_ENABLED',
                true,
            ),
        },
        walletTokens: {
            allowlist: readOptionalAddressSet('WALLET_TOKEN_ALLOWLIST_56'),
            blocklist: readOptionalAddressSet('WALLET_TOKEN_BLOCKLIST_56'),
            meaningfulLiquidityUsd: readConfiguredNumber(
                'WALLET_TOKEN_MEANINGFUL_LIQUIDITY_USD',
                10_000,
                0,
            ),
            strongLiquidityUsd: readConfiguredNumber(
                'WALLET_TOKEN_STRONG_LIQUIDITY_USD',
                50_000,
                0,
            ),
        },
        quotes: {
            mode:
                process.env.QUOTE_PROVIDER_MODE?.trim().toLowerCase() ||
                'best',
            providers: (
                process.env.QUOTE_PROVIDERS ||
                'uniswap,0x,pancakeswap'
            )
                .split(',')
                .map((value) => value.trim().toLowerCase()),
            timeoutMs: readInteger('QUOTE_TIMEOUT_MS', 10_000, 1),
            uniswap: {
                enabled: readBoolean('UNISWAP_ENABLED', true),
                apiKey: process.env.UNISWAP_API_KEY?.trim() || null,
                baseUrl: readUrl(
                    'UNISWAP_API_BASE_URL',
                    'https://trade-api.gateway.uniswap.org/v1',
                    ['trade-api.gateway.uniswap.org'],
                ),
            },
            zeroX: {
                enabled: readBoolean('ZEROX_ENABLED', true),
                apiKey: process.env.ZEROX_API_KEY?.trim() || null,
                baseUrl: readUrl(
                    'ZEROX_API_BASE_URL',
                    'https://api.0x.org',
                    ['api.0x.org'],
                ),
            },
            pancakeSwap: {
                enabled: readBoolean('PANCAKESWAP_ENABLED', true),
                routerAddress: normalizeAddress(
                    process.env.PANCAKESWAP_ROUTER_ADDRESS_56,
                ),
                quoterAddress: normalizeAddress(
                    process.env.PANCAKESWAP_QUOTER_ADDRESS_56,
                ),
                wrappedNativeAddress: normalizeAddress(
                    process.env.PANCAKESWAP_WRAPPED_NATIVE_ADDRESS_56,
                ),
                rpcUrl: readRpcUrl('BSC_RPC_URL') || getAlchemyRpcUrl(),
                feeExecutorAddress: normalizeAddress(
                    process.env.FEE_EXECUTOR_ADDRESS_56,
                ),
            },
        },
        gasAssist: {
            mode:
                process.env.GAS_ASSIST_MODE?.trim().toLowerCase() ||
                (readBoolean('GAS_ASSIST_ENABLED', false)
                    ? 'megafuel-legacy'
                    : 'disabled'),
            enabled:
                (process.env.GAS_ASSIST_MODE?.trim().toLowerCase() ||
                    (readBoolean('GAS_ASSIST_ENABLED', false)
                        ? 'megafuel-legacy'
                        : 'disabled')) !== 'disabled',
            chainId: readConfiguredInteger('GAS_ASSIST_CHAIN_ID', 56, 1),
            swapContractAddress: normalizeAddress(
                process.env.GAS_ASSIST_SWAP_CONTRACT_ADDRESS_56,
            ),
            allowedTokens: readAddressSet('GAS_ASSIST_ALLOWED_TOKENS_56'),
            paymasterRpcUrl: readOptionalHttpsUrl('GAS_ASSIST_PAYMASTER_RPC_URL'),
            paymasterPolicyId:
                process.env.GAS_ASSIST_PAYMASTER_POLICY_ID?.trim() || null,
            nodeRealApiKey:
                process.env.GAS_ASSIST_NODEREAL_API_KEY?.trim() || null,
            quoteTtlSeconds: readConfiguredInteger(
                'GAS_ASSIST_QUOTE_TTL_SECONDS',
                45,
                10,
                300,
            ),
            minimumSellUsd: readPositiveDecimal(
                'GAS_ASSIST_MIN_SELL_USD',
                '1',
            ),
            minimumUserOutputUsd: readPositiveDecimal(
                'GAS_ASSIST_MIN_USER_OUTPUT_USD',
                '0.10',
            ),
            maximumPriceImpactBps: readConfiguredInteger(
                'GAS_ASSIST_MAX_PRICE_IMPACT_BPS',
                2_000,
                1,
                10_000,
            ),
            requireStrictTokenSecurity: readBoolean(
                'GAS_ASSIST_REQUIRE_STRICT_TOKEN_SECURITY',
                true,
            ),
            rejectUnlimitedPermits: readBoolean(
                'GAS_ASSIST_REJECT_UNLIMITED_PERMITS',
                false,
            ),
            feeTokenMode:
                process.env.GAS_ASSIST_FEE_TOKEN_MODE?.trim() || 'sellToken',
            statusPollIntervalMs: readConfiguredInteger(
                'GAS_ASSIST_STATUS_POLL_INTERVAL_MS',
                3_000,
                1_000,
                60_000,
            ),
            statusTimeoutMs: readConfiguredInteger(
                'GAS_ASSIST_STATUS_TIMEOUT_MS',
                120_000,
                10_000,
                600_000,
            ),
            quoteWalletLimitPerHour: readConfiguredInteger(
                'GAS_ASSIST_QUOTE_WALLET_LIMIT_PER_HOUR',
                10,
                1,
                100,
            ),
            dailyWalletLimit: readConfiguredInteger(
                'GAS_ASSIST_DAILY_WALLET_LIMIT',
                3,
                1,
                100,
            ),
            dailyIpLimit: readConfiguredInteger(
                'GAS_ASSIST_DAILY_IP_LIMIT',
                20,
                1,
                1_000,
            ),
            maximumApprovalUsd: readPositiveDecimal(
                'GAS_ASSIST_MAX_APPROVAL_USD',
                '100',
            ),
            maximumGasLimit: readConfiguredInteger(
                'GAS_ASSIST_MAX_GAS_LIMIT',
                150_000,
                21_000,
                1_000_000,
            ),
            ipHashSecret:
                process.env.GAS_ASSIST_IP_HASH_SECRET?.trim() || null,
            mainnetConfirmation:
                process.env.GAS_ASSIST_MAINNET_CONFIRMATION?.trim() || null,
            databaseConfigured: Boolean(process.env.DATABASE_URL?.trim()),
            configRulesJson:
                process.env.GAS_ASSIST_SPONSOR_RULES_56_JSON?.trim() || null,
            requestTimeoutMs: Math.min(
                readInteger('PROVIDER_REQUEST_TIMEOUT_MS', 10_000, 1),
                30_000,
            ),
        },
        fees: {
            treasuryAddress: normalizeAddress(
                process.env.TREASURY_ADDRESS,
            ),
            platformFeeBps,
            collectionMode:
                process.env.FEE_COLLECTION_MODE?.trim() ||
                'provider-affiliate',
            tokenMode:
                process.env.FEE_TOKEN_MODE?.trim() || 'buyToken',
        },
    }
}

export type ApiConfig = ReturnType<typeof getApiConfig>

export function validateStartupConfig(config = getApiConfig()) {
    const validQuoteModes = new Set([
        'best',
        'uniswap',
        '0x',
        'pancakeswap',
    ])
    const validFeeModes = new Set([
        'none',
        'provider-affiliate',
        'executor-contract',
    ])
    const validGasAssistModes = new Set([
        'disabled',
        'zero-x-gasless',
        'megafuel-legacy',
    ])

    if (!validQuoteModes.has(config.quotes.mode)) {
        throw new Error('QUOTE_PROVIDER_MODE is invalid.')
    }

    if (!validFeeModes.has(config.fees.collectionMode)) {
        throw new Error('FEE_COLLECTION_MODE is invalid.')
    }

    if (config.fees.tokenMode !== 'buyToken') {
        throw new Error('Only FEE_TOKEN_MODE=buyToken is supported.')
    }

    if (
        config.fees.platformFeeBps > 0 &&
        !config.fees.treasuryAddress
    ) {
        throw new Error(
            'A nonzero platform fee requires TREASURY_ADDRESS.',
        )
    }

    if (
        config.fees.platformFeeBps > 0 &&
        config.fees.collectionMode === 'executor-contract' &&
        !config.quotes.pancakeSwap.feeExecutorAddress
    ) {
        throw new Error(
            'executor-contract fee mode requires FEE_EXECUTOR_ADDRESS_56.',
        )
    }

    if (
        config.fees.platformFeeBps > 0 &&
        config.fees.collectionMode === 'none'
    ) {
        throw new Error(
            'A nonzero platform fee requires a collection mode.',
        )
    }

    if (
        config.fees.platformFeeBps > 0 &&
        config.fees.collectionMode === 'provider-affiliate' &&
        (!config.quotes.zeroX.enabled || !config.quotes.zeroX.apiKey)
    ) {
        throw new Error(
            'provider-affiliate fee mode requires an enabled provider with documented affiliate-fee support.',
        )
    }

    if (!validGasAssistModes.has(config.gasAssist.mode)) {
        throw new Error('GAS_ASSIST_MODE is invalid.')
    }

    if (config.gasAssist.mode === 'zero-x-gasless') {
        const errors: string[] = []
        if (config.gasAssist.chainId !== 56) {
            errors.push('GAS_ASSIST_CHAIN_ID must be exactly 56')
        }
        if (!config.quotes.zeroX.apiKey) {
            errors.push('ZEROX_API_KEY is required')
        }
        if (!config.gasAssist.databaseConfigured) {
            errors.push('DATABASE_URL is required')
        }
        if (config.gasAssist.feeTokenMode !== 'sellToken') {
            errors.push('GAS_ASSIST_FEE_TOKEN_MODE must be sellToken')
        }
        if (
            config.fees.platformFeeBps > 0 &&
            (!config.fees.treasuryAddress ||
                config.fees.treasuryAddress === NATIVE_TOKEN_ADDRESS)
        ) {
            errors.push('a nonzero PLATFORM_FEE_BPS requires a nonzero TREASURY_ADDRESS')
        }
        if (errors.length > 0) {
            throw new Error(`0x Gas Assist configuration is unsafe: ${errors.join('; ')}.`)
        }
    }

    if (config.gasAssist.mode === 'megafuel-legacy') {
        const errors: string[] = []
        if (config.gasAssist.chainId !== 56) {
            errors.push('GAS_ASSIST_CHAIN_ID must be exactly 56')
        }
        if (
            config.gasAssist.mainnetConfirmation !==
            'I_UNDERSTAND_GAS_ASSIST_SPENDS_REAL_BNB'
        ) {
            errors.push('GAS_ASSIST_MAINNET_CONFIRMATION is missing or incorrect')
        }
        if (!config.gasAssist.swapContractAddress) {
            errors.push('GAS_ASSIST_SWAP_CONTRACT_ADDRESS_56 is required and must be valid')
        }
        if (config.gasAssist.swapContractAddress === NATIVE_TOKEN_ADDRESS) {
            errors.push('GAS_ASSIST_SWAP_CONTRACT_ADDRESS_56 cannot be the zero address')
        }
        if (config.gasAssist.allowedTokens.has(NATIVE_TOKEN_ADDRESS)) {
            errors.push('GAS_ASSIST_ALLOWED_TOKENS_56 cannot contain native BNB')
        }
        if (config.fees.collectionMode !== 'executor-contract') {
            errors.push('FEE_COLLECTION_MODE must be executor-contract so swaps use the Gas Assist spender')
        }
        if (
            config.gasAssist.swapContractAddress &&
            config.quotes.pancakeSwap.feeExecutorAddress !==
                config.gasAssist.swapContractAddress
        ) {
            errors.push('FEE_EXECUTOR_ADDRESS_56 must equal GAS_ASSIST_SWAP_CONTRACT_ADDRESS_56')
        }
        if (!config.gasAssist.paymasterRpcUrl) {
            errors.push('GAS_ASSIST_PAYMASTER_RPC_URL is required')
        }
        if (!config.gasAssist.paymasterPolicyId) {
            errors.push('GAS_ASSIST_PAYMASTER_POLICY_ID is required')
        }
        if (!config.gasAssist.databaseConfigured) {
            errors.push('DATABASE_URL is required')
        }
        if (!config.gasAssist.ipHashSecret || config.gasAssist.ipHashSecret.length < 32) {
            errors.push('GAS_ASSIST_IP_HASH_SECRET must be at least 32 characters')
        }
        if (config.gasAssist.configRulesJson) {
            errors.push('GAS_ASSIST_SPONSOR_RULES_56_JSON cannot be mixed with PostgreSQL mode')
        }
        if (errors.length > 0) {
            throw new Error(`Gas Assist configuration is unsafe: ${errors.join('; ')}.`)
        }
    }

    return config
}
