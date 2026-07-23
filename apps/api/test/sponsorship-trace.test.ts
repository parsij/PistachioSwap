import { afterEach, describe, expect, it, vi } from 'vitest'

import { GasAssistError } from '../src/gas-assist/errors.js'
import {
    sponsorshipErrorDetails,
    sponsorshipTrace,
    sponsorshipTraceInternals,
} from '../src/gas-assist/trace.js'

afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
})

describe('sponsorship trace', () => {
    it('remains silent unless explicitly enabled', () => {
        vi.stubEnv('DEBUG_SPONSORSHIP_TRACE', 'false')
        const output = vi.spyOn(console, 'error').mockImplementation(() => undefined)

        sponsorshipTrace('test.event', { orderId: 'order-1' })

        expect(output).not.toHaveBeenCalled()
    })

    it('redacts credentials and signed transactions', () => {
        const value = sponsorshipTraceInternals.safeValue({
            authorization: 'Bearer secret',
            privateKey: '0xsecret',
            sessionToken: 'session-secret',
            signedRawTransaction: '0xsigned',
            orderId: 'order-1',
        })

        expect(value).toEqual({
            authorization: '[redacted]',
            privateKey: '[redacted]',
            sessionToken: '[redacted]',
            signedRawTransaction: '[redacted]',
            orderId: 'order-1',
        })
    })

    it('includes typed and PostgreSQL diagnostics without requiring an API leak', () => {
        const typed = sponsorshipErrorDetails(new GasAssistError(
            'PAYMASTER_POLICY_TIMEOUT',
            'Policy update timed out.',
            504,
            { rpcMethod: 'pm_addToWhitelist' },
        ))
        expect(typed).toMatchObject({
            name: 'GasAssistError',
            gasAssistCode: 'PAYMASTER_POLICY_TIMEOUT',
            statusCode: 504,
        })

        const databaseError = Object.assign(new Error('duplicate key'), {
            code: '23505',
            constraint: 'sponsorship_intents_active_wallet_nonce_idx',
            table: 'sponsorship_transaction_intents',
        })
        expect(sponsorshipErrorDetails(databaseError)).toMatchObject({
            name: 'Error',
            message: 'duplicate key',
            postgresCode: '23505',
            constraint: 'sponsorship_intents_active_wallet_nonce_idx',
            table: 'sponsorship_transaction_intents',
        })
    })
})
