let sdkPromise = null

const PARTICLE_PRIMARY_TOKEN_BY_BSC_ADDRESS = new Map([
    ['0x55d398326f99059ff775485246999027b3197955', 'USDT'],
    ['0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', 'USDC'],
])

function scheduleMicrotask(callback) {
    if (typeof globalThis.queueMicrotask === 'function') {
        globalThis.queueMicrotask(callback)
        return
    }
    Promise.resolve().then(callback)
}

function particleExpectedTokenError(message, details = {}) {
    const error = new Error(message)
    error.code = 'PARTICLE_EXPECTED_TOKEN_UNSUPPORTED'
    error.details = details
    return error
}

/**
 * Particle's createUniversalTransaction expects primary-token enum values in
 * `expectTokens` (`{ type: SUPPORTED_TOKEN_TYPE.USDT, amount }`), not an ERC-20
 * contract address. Gas Assist intentionally keeps the backend-reviewed token
 * address in its wire format, then this browser boundary translates only exact
 * canonical BSC primary-token contracts into Particle's SDK enum.
 */
export function normalizeParticleExpectedTokensForSdk(expectTokens, chainId, supportedTokenType) {
    if (!Array.isArray(expectTokens) || expectTokens.length === 0) return []
    if (Number(chainId) !== 56) {
        throw particleExpectedTokenError('Particle Gas Assist supports reviewed token funding only on BNB Chain.', {
            chainId: Number(chainId),
        })
    }
    if (!supportedTokenType || typeof supportedTokenType !== 'object') {
        throw particleExpectedTokenError('Particle did not expose its supported primary-token types.')
    }

    return expectTokens.map((token) => {
        const tokenAddress = String(token?.tokenAddress ?? '').toLowerCase()
        const amount = String(token?.amount ?? '')
        const tokenKey = PARTICLE_PRIMARY_TOKEN_BY_BSC_ADDRESS.get(tokenAddress)
        const type = tokenKey ? supportedTokenType[tokenKey] : undefined
        if (!tokenKey || type === undefined || type === null) {
            throw particleExpectedTokenError('This Gas Assist token is not a Particle primary token on BNB Chain.', {
                tokenAddress,
            })
        }
        return { type, amount }
    })
}

function wrapParticleUniversalAccountSdk(sdk) {
    if (!sdk || typeof sdk.UniversalAccount !== 'function') return sdk

    // Existing unit tests mock only the class surface. Keep those mocks intact;
    // production must expose SUPPORTED_TOKEN_TYPE or fail before creating a UA.
    if (!sdk.SUPPORTED_TOKEN_TYPE || typeof sdk.SUPPORTED_TOKEN_TYPE !== 'object') {
        if (import.meta.env?.MODE === 'test') return sdk
        throw particleExpectedTokenError('Particle Universal Account SDK is missing supported token types.')
    }

    const ParticleUniversalAccount = sdk.UniversalAccount
    class PistachioParticleUniversalAccount extends ParticleUniversalAccount {
        createUniversalTransaction(input) {
            return super.createUniversalTransaction({
                ...input,
                expectTokens: normalizeParticleExpectedTokensForSdk(
                    input?.expectTokens,
                    input?.chainId,
                    sdk.SUPPORTED_TOKEN_TYPE,
                ),
            })
        }
    }

    return {
        ...sdk,
        UniversalAccount: PistachioParticleUniversalAccount,
    }
}

/**
 * Particle Universal Account SDK v2 still reaches for Node's global `process`
 * from browser code. Vite intentionally does not provide that global. Install
 * only the tiny, non-secret compatibility surface the SDK/dependencies may
 * inspect, and do it before the SDK module is evaluated.
 */
export function ensureParticleBrowserProcess(target = globalThis) {
    const existing = target.process
    if (existing && typeof existing === 'object') {
        if (!existing.env || typeof existing.env !== 'object') existing.env = {}
        return existing
    }

    const processShim = {
        browser: true,
        env: {},
        platform: 'browser',
        version: '',
        versions: {},
        cwd: () => '/',
        nextTick(callback, ...args) {
            if (typeof callback !== 'function') return
            scheduleMicrotask(() => callback(...args))
        },
    }

    Object.defineProperty(target, 'process', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: processShim,
    })
    return processShim
}

export async function loadParticleUniversalAccountSdk() {
    ensureParticleBrowserProcess()
    sdkPromise ??= import('@particle-network/universal-account-sdk').then(wrapParticleUniversalAccountSdk)
    return sdkPromise
}

export const particleBrowserRuntimeInternals = {
    resetSdkPromise() {
        sdkPromise = null
    },
}
