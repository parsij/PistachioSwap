let sdkPromise = null

function scheduleMicrotask(callback) {
    if (typeof globalThis.queueMicrotask === 'function') {
        globalThis.queueMicrotask(callback)
        return
    }
    Promise.resolve().then(callback)
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
    sdkPromise ??= import('@particle-network/universal-account-sdk')
    return sdkPromise
}

export const particleBrowserRuntimeInternals = {
    resetSdkPromise() {
        sdkPromise = null
    },
}
