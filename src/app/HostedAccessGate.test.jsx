// @vitest-environment jsdom

import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import HostedAccessGate from './HostedAccessGate.jsx'

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
})

function response(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    })
}

describe('HostedAccessGate', () => {
    it('mounts the hosted app only after the jurisdiction is allowed', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response({
            allowed: true,
            decision: 'allow',
        })))

        render(
            <HostedAccessGate enforce>
                <div>Swap application mounted</div>
            </HostedAccessGate>,
        )

        expect(screen.getByText('Checking availability')).toBeTruthy()
        await waitFor(() => {
            expect(screen.getByText('Swap application mounted')).toBeTruthy()
        })
    })

    it('keeps the hosted app unmounted when the jurisdiction is blocked', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response({
            allowed: false,
            decision: 'block',
        })))

        render(
            <HostedAccessGate enforce>
                <div>Swap application mounted</div>
            </HostedAccessGate>,
        )

        await waitFor(() => {
            expect(screen.getByText('PistachioSwap is not available in your location')).toBeTruthy()
        })
        expect(screen.queryByText('Swap application mounted')).toBeNull()
    })

    it('fails closed when the access endpoint is unavailable', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'unavailable' }, 503)))

        render(
            <HostedAccessGate enforce>
                <div>Swap application mounted</div>
            </HostedAccessGate>,
        )

        await waitFor(() => {
            expect(screen.getByText('PistachioSwap is temporarily unavailable')).toBeTruthy()
        })
        expect(screen.queryByText('Swap application mounted')).toBeNull()
        expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    })
})
