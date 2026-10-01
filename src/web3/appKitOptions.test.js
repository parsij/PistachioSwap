import { describe, expect, it } from 'vitest'

import {
    APPKIT_CONNECTOR_TYPE_ORDER,
    APPKIT_ENABLE_MOBILE_FULL_SCREEN,
} from './appKitOptions.js'

describe('AppKit wallet menu ordering', () => {
    it('keeps the connect-wallet router content-sized instead of full-screen', () => {
        expect(APPKIT_ENABLE_MOBILE_FULL_SCREEN).toBe(false)
    })

    it('puts external connectors first so Pistachio Wallet is at the top', () => {
        expect(APPKIT_CONNECTOR_TYPE_ORDER[0]).toBe('external')
        expect(new Set(APPKIT_CONNECTOR_TYPE_ORDER).size).toBe(APPKIT_CONNECTOR_TYPE_ORDER.length)
    })
})
