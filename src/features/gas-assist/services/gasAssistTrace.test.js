// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'

import {
    gasAssistErrorDetails,
    gasAssistTrace,
    gasAssistTraceInternals,
} from './gasAssistTrace.js'

describe('frontend Gas Assist tracing', () => {
    it('redacts wallet credentials and signed transaction bytes', () => {
        expect(gasAssistTraceInternals.safeValue({
            authorization: 'Bearer secret',
            privateKey: '0xprivate',
            sessionToken: 'session',
            signature: '0xsignature',
            signedRawTransaction: '0xsigned',
            signedTransactions: [{ signedRawTransaction: '0xsigned' }],
            orderId: 'order-1',
        })).toEqual({
            authorization: '[redacted]',
            privateKey: '[redacted]',
            sessionToken: '[redacted]',
            signature: '[redacted]',
            signedRawTransaction: '[redacted]',
            signedTransactions: '[redacted]',
            orderId: 'order-1',
        })
    })

    it('prints structured stage and error information without raw credentials', () => {
        const output = vi.spyOn(console, 'info').mockImplementation(() => undefined)
        gasAssistTrace('package.prepare.start', {
            orderId: 'order-1',
            sessionToken: 'secret',
        })
        expect(output).toHaveBeenCalledWith('[gas-assist-trace]', expect.objectContaining({
            event: 'package.prepare.start',
            orderId: 'order-1',
            sessionToken: '[redacted]',
        }))
        output.mockRestore()
    })

    it('keeps typed diagnostics available for the technical drawer', () => {
        const error = Object.assign(new Error('Provider timed out.'), {
            code: 'PAYMASTER_TIMEOUT',
            stage: 'package.prepare',
            requestId: 'request-123',
            details: { signedRawTransaction: '0xsigned', attempts: 3 },
        })
        expect(gasAssistErrorDetails(error)).toMatchObject({
            name: 'Error',
            message: 'Provider timed out.',
            code: 'PAYMASTER_TIMEOUT',
            stage: 'package.prepare',
            requestId: 'request-123',
            details: {
                signedRawTransaction: '[redacted]',
                attempts: 3,
            },
        })
    })
})
