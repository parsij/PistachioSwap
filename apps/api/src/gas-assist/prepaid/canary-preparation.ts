import { ProviderError } from '../../lib/errors.js'

export type CanaryPreparationConfig = {
    attempts: number
    retryDelayMs: number
}

type RetryDetails = {
    attempt: number
    maximumAttempts: number
    delayMs: number
    code: string
    message: string
    provider: string | null
    rpcMethod: string | null
}

function boundedInteger(
    env: NodeJS.ProcessEnv,
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
) {
    const raw = env[name]?.trim()
    if (!raw) return fallback
    if (!/^\d+$/.test(raw)) {
        throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`)
    }
    const value = Number(raw)
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`)
    }
    return value
}

export function getCanaryPreparationConfig(
    env: NodeJS.ProcessEnv = process.env,
): CanaryPreparationConfig {
    return {
        attempts: boundedInteger(
            env,
            'XAUT_CANARY_PREPARATION_ATTEMPTS',
            6,
            1,
            10,
        ),
        retryDelayMs: boundedInteger(
            env,
            'XAUT_CANARY_RETRY_DELAY_MS',
            10_000,
            1_000,
            60_000,
        ),
    }
}

function errorChain(error: unknown) {
    const result: unknown[] = []
    let current = error
    for (let depth = 0; current && depth < 8; depth += 1) {
        result.push(current)
        current = current instanceof Error ? current.cause : undefined
    }
    return result
}

export function isTransientPreparationError(error: unknown) {
    return errorChain(error).some((item) => {
        if (item instanceof ProviderError) {
            return item.retryable ||
                ['rate-limit', 'timeout', 'upstream'].includes(item.outcome)
        }
        if (!(item instanceof Error)) return false
        const code = String((item as Error & { code?: unknown }).code ?? '')
        const fingerprint = `${item.name} ${code} ${item.message}`.toLowerCase()
        return /fetch failed|network|dns|timeout|timed out|socket|econnreset|econnrefused|enotfound|eai_again|httprequesterror|rpc request failed/.test(fingerprint)
    })
}

export function trustedPriceUnavailable(cause?: unknown) {
    const providerError = errorChain(cause).find(
        (item): item is ProviderError => item instanceof ProviderError,
    )
    return new ProviderError({
        code: 'TRUSTED_PRICE_UNAVAILABLE',
        message: 'A fresh trusted token price is temporarily unavailable.',
        statusCode: 503,
        retryable: true,
        outcome: providerError?.outcome ?? 'upstream',
        upstreamStatus: providerError?.upstreamStatus ?? null,
        providers: providerError?.providers ?? [{
            provider: 'trusted-price',
            outcome: providerError?.outcome ?? 'upstream',
            upstreamStatus: providerError?.upstreamStatus ?? null,
            code: providerError?.code ?? 'TRUSTED_PRICE_UNAVAILABLE',
            message: providerError?.message ?? 'No trusted price was returned.',
            retryable: true,
        }],
        cause,
    })
}

function safeRetryDetails(
    error: unknown,
    attempt: number,
    maximumAttempts: number,
    delayMs: number,
): RetryDetails {
    const providerError = errorChain(error).find(
        (item): item is ProviderError => item instanceof ProviderError,
    )
    return {
        attempt,
        maximumAttempts,
        delayMs,
        code: providerError?.code ?? 'PROVIDER_TEMPORARILY_UNAVAILABLE',
        message: providerError?.message ?? 'A provider or RPC request failed transiently.',
        provider: providerError?.providers?.[0]?.provider ?? null,
        rpcMethod: null,
    }
}

export async function retryCanaryPreparation<T>(
    operation: (attempt: number) => Promise<T>,
    {
        config = getCanaryPreparationConfig(),
        wait = (delayMs: number) => new Promise<void>(
            (resolve) => setTimeout(resolve, delayMs),
        ),
        onRetry = () => undefined,
    }: {
        config?: CanaryPreparationConfig
        wait?: (delayMs: number) => Promise<void>
        onRetry?: (details: RetryDetails) => void
    } = {},
) {
    let lastError: unknown
    for (let attempt = 1; attempt <= config.attempts; attempt += 1) {
        try {
            return await operation(attempt)
        } catch (error) {
            lastError = error
            if (!isTransientPreparationError(error) || attempt >= config.attempts) {
                throw error instanceof ProviderError &&
                    error.code === 'TRUSTED_PRICE_UNAVAILABLE'
                    ? error
                    : isTransientPreparationError(error)
                        ? trustedPriceUnavailable(error)
                        : error
            }
            onRetry(safeRetryDetails(
                error,
                attempt,
                config.attempts,
                config.retryDelayMs,
            ))
            await wait(config.retryDelayMs)
        }
    }
    throw trustedPriceUnavailable(lastError)
}
