import { describe, expect, it, vi } from 'vitest'

import { ProviderError } from '../src/lib/errors.js'
import {
    getCanaryPreparationConfig,
    retryCanaryPreparation,
    trustedPriceUnavailable,
} from '../src/gas-assist/prepaid/canary-preparation.js'

describe('XAUT canary preparation configuration', () => {
    it('uses the bounded defaults', () => {
        expect(getCanaryPreparationConfig({})).toEqual({
            attempts: 6,
            retryDelayMs: 10_000,
        })
    })

    it.each([
        ['XAUT_CANARY_PREPARATION_ATTEMPTS', '0'],
        ['XAUT_CANARY_PREPARATION_ATTEMPTS', '11'],
        ['XAUT_CANARY_RETRY_DELAY_MS', '999'],
        ['XAUT_CANARY_RETRY_DELAY_MS', '60001'],
        ['XAUT_CANARY_RETRY_DELAY_MS', 'invalid'],
    ])('rejects malformed or out-of-range %s', (name, value) => {
        expect(() => getCanaryPreparationConfig({ [name]: value }))
            .toThrow(`${name} must be an integer`)
    })
})

describe('XAUT canary preparation retries', () => {
    it('retries transient provider failures with the configured bound', async () => {
        const operation = vi.fn()
            .mockRejectedValueOnce(new ProviderError({
                code: 'PROVIDER_UNAVAILABLE',
                message: 'Provider request failed after bounded retries.',
                retryable: true,
            }))
            .mockResolvedValue('prepared')
        const wait = vi.fn().mockResolvedValue(undefined)
        const onRetry = vi.fn()

        await expect(retryCanaryPreparation(operation, {
            config: { attempts: 3, retryDelayMs: 1_000 },
            wait,
            onRetry,
        })).resolves.toBe('prepared')
        expect(operation).toHaveBeenCalledTimes(2)
        expect(wait).toHaveBeenCalledWith(1_000)
        expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
            attempt: 1,
            maximumAttempts: 3,
            code: 'PROVIDER_UNAVAILABLE',
        }))
    })

    it('fails fast for permanent validation failures', async () => {
        const permanent = new Error('XAUT_TEST_WALLET_ADDRESS does not match.')
        const operation = vi.fn().mockRejectedValue(permanent)
        const wait = vi.fn()

        await expect(retryCanaryPreparation(operation, {
            config: { attempts: 6, retryDelayMs: 10_000 },
            wait,
        })).rejects.toBe(permanent)
        expect(operation).toHaveBeenCalledTimes(1)
        expect(wait).not.toHaveBeenCalled()
    })

    it('throws a typed trusted-price error instead of exposing null', async () => {
        const operation = vi.fn().mockRejectedValue(trustedPriceUnavailable())

        await expect(retryCanaryPreparation(operation, {
            config: { attempts: 2, retryDelayMs: 1_000 },
            wait: vi.fn().mockResolvedValue(undefined),
        })).rejects.toMatchObject({
            name: 'ProviderError',
            code: 'TRUSTED_PRICE_UNAVAILABLE',
            retryable: true,
        })
        expect(operation).toHaveBeenCalledTimes(2)
    })
})
