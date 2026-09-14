import { describe, expect, it } from 'vitest'

import { APPKIT_CONNECTOR_TYPE_ORDER } from './appKitOptions.js'

describe('AppKit wallet menu ordering', () => {
    it('puts external connectors first so Pistachio Wallet is at the top', () => {
        expect(APPKIT_CONNECTOR_TYPE_ORDER[0]).toBe('external')
        expect(new Set(APPKIT_CONNECTOR_TYPE_ORDER).size).toBe(APPKIT_CONNECTOR_TYPE_ORDER.length)
    })
})
