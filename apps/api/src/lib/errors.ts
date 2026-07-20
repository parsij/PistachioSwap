export type ProviderOutcome =
    | 'no-route'
    | 'configuration'
    | 'authentication'
    | 'validation'
    | 'rate-limit'
    | 'timeout'
    | 'upstream'

export type ProviderDiagnostic = {
    provider: string
    outcome: ProviderOutcome
    category?:
        | 'valid-route'
        | 'no-route'
        | 'amount-below-provider-minimum'
        | 'no-liquidity'
        | 'unsupported-token'
        | 'timeout'
        | 'rate-limited'
        | 'temporary-failure'
        | 'malformed-or-unsafe-quote'
        | 'configuration-error'
        | 'skipped-not-eligible'
    upstreamStatus: number | null
    code: string | null
    message: string
    minimumInputAmountUsd?: string | null
    retryable?: boolean
}

export class ProviderError extends Error {
    readonly code: string
    readonly statusCode: number
    readonly retryable: boolean
    readonly outcome: ProviderOutcome
    readonly upstreamStatus: number | null
    readonly providers: ProviderDiagnostic[] | null
    readonly retryAfterMs: number

    constructor({
        code,
        message,
        statusCode = 502,
        retryable = false,
        outcome = 'upstream',
        upstreamStatus = null,
        providers = null,
        retryAfterMs = 0,
        cause,
    }: {
        code: string
        message: string
        statusCode?: number
        retryable?: boolean
        outcome?: ProviderOutcome
        upstreamStatus?: number | null
        providers?: ProviderDiagnostic[] | null
        retryAfterMs?: number
        cause?: unknown
    }) {
        super(message, { cause })
        this.name = 'ProviderError'
        this.code = code
        this.statusCode = statusCode
        this.retryable = retryable
        this.outcome = outcome
        this.upstreamStatus = upstreamStatus
        this.providers = providers
        this.retryAfterMs = retryAfterMs
    }
}

export function getSafeError(error: unknown) {
    if (error instanceof ProviderError) {
        return {
            statusCode: error.statusCode,
            body: {
                error: {
                    code: error.code,
                    message: error.message,
                    ...(error.providers
                        ? { providers: error.providers }
                        : {}),
                },
            },
        }
    }

    return {
        statusCode: 502,
        body: {
            error: {
                code: 'PROVIDER_UNAVAILABLE',
                message:
                    'A required market-data provider is currently unavailable.',
            },
        },
    }
}
