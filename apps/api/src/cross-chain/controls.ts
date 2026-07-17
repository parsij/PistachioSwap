export class ProviderControls {
    private active = 0
    private failures = 0
    private openUntil = 0
    private nextRequestAt = 0

    constructor(
        private readonly maximumConcurrent = 4,
        private readonly minimumIntervalMs = 50,
        private readonly failureThreshold = 3,
        private readonly resetMs = 30_000,
    ) {}

    async run<T>(operation: () => Promise<T>): Promise<T> {
        const now = Date.now()
        if (now < this.openUntil) {
            throw new Error('Provider circuit is temporarily open.')
        }
        if (this.active >= this.maximumConcurrent) {
            throw new Error('Provider request rate is temporarily limited.')
        }

        this.active += 1
        const startAt = Math.max(now, this.nextRequestAt)
        this.nextRequestAt = startAt + this.minimumIntervalMs
        try {
            if (startAt > now) {
                await new Promise((resolve) => setTimeout(resolve, startAt - now))
            }
            const result = await operation()
            this.failures = 0
            return result
        } catch (error) {
            this.failures += 1
            if (this.failures >= this.failureThreshold) {
                this.openUntil = Date.now() + this.resetMs
                this.failures = 0
            }
            throw error
        } finally {
            this.active -= 1
        }
    }
}

export class CapabilityCache {
    private entries = new Map<string, {
        value: unknown
        expiresAt: number
    }>()

    async get<T>(
        key: string,
        load: () => Promise<T>,
        positiveTtlMs: number,
        negativeTtlMs: number,
    ): Promise<T> {
        const cached = this.entries.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.value as T

        const value = await load()
        const available =
            typeof value === 'object' &&
            value !== null &&
            'available' in value &&
            value.available === true
        this.entries.set(key, {
            value,
            expiresAt: Date.now() + (available ? positiveTtlMs : negativeTtlMs),
        })
        return value
    }
}
