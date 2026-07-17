import { describe, expect, it } from 'vitest'

import { validateWorkerRequest, walletWorkerProtocolInternals } from './walletWorkerProtocol.js'

describe('Pistachio wallet worker protocol', () => {
    it('rejects unknown operations and malformed request IDs', () => {
        expect(() => validateWorkerRequest({ id: 1, operation: 'stealSecrets', payload: {} })).toThrow('Unknown')
        expect(() => validateWorkerRequest({ id: 0, operation: 'lock', payload: {} })).toThrow('Unknown')
    })

    it('contains only the narrow documented operation set', () => {
        expect(walletWorkerProtocolInternals.operationSet.has('signTransaction')).toBe(true)
        expect(walletWorkerProtocolInternals.operationSet.has('fetch')).toBe(false)
        expect(walletWorkerProtocolInternals.operationSet.has('broadcast')).toBe(false)
    })
})
