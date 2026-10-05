// Backend capabilities are the sole authority; receipt identities survive creation pauses.
const deployments = new Map()
export function rememberGasAssistCapabilities(config) {
    const entries = config?.capabilities ?? (config?.chainId && config.supported !== false ? { [config.chainId]: config } : {})
    for (const [key, entry] of Object.entries(entries)) {
        const id = Number(key)
        if (!Number.isSafeInteger(id) || id <= 0 || Number(entry?.chainId) !== id) continue
        deployments.set(id, Object.freeze({ ...entry, enabled: entry.enabled === true }))
    }
    return config
}
export function getGasAssistCapability(chainId) { return deployments.get(Number(chainId)) ?? null }
export function clearGasAssistCapabilities() { deployments.clear() }
