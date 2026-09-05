import { useCallback, useEffect, useState } from 'react'

import { apiBaseUrl } from '../lib/apiBaseUrl.js'

function AccessGatePage({ status, onRetry }) {
    const checking = status === 'checking'
    const blocked = status === 'blocked'

    return (
        <main className="min-h-screen bg-[#0b0b0b] px-6 py-10 text-white">
            <div className="mx-auto flex min-h-[80vh] max-w-xl items-center justify-center">
                <section className="w-full rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center shadow-2xl">
                    <div className="mb-6 text-2xl font-semibold tracking-tight">PistachioSwap</div>
                    <h1 className="text-2xl font-semibold">
                        {checking
                            ? 'Checking availability'
                            : blocked
                              ? 'PistachioSwap is not available in your location'
                              : 'PistachioSwap is temporarily unavailable'}
                    </h1>
                    <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-white/65">
                        {checking
                            ? 'We are verifying whether the hosted PistachioSwap interface is available in your jurisdiction.'
                            : blocked
                              ? 'Access to the hosted PistachioSwap interface is restricted in your jurisdiction.'
                              : 'We could not verify access eligibility. The interface stays unavailable until the compliance check succeeds.'}
                    </p>
                    {!checking && !blocked ? (
                        <button
                            type="button"
                            onClick={onRetry}
                            className="mt-6 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-white/90"
                        >
                            Try again
                        </button>
                    ) : null}
                </section>
            </div>
        </main>
    )
}

function EnforcedHostedAccessGate({ children }) {
    const [accessStatus, setAccessStatus] = useState('checking')

    const checkAccess = useCallback(async () => {
        setAccessStatus('checking')
        try {
            const response = await fetch(`${apiBaseUrl}/v1/compliance/access`, {
                method: 'GET',
                headers: { accept: 'application/json' },
                cache: 'no-store',
                credentials: 'omit',
            })
            if (!response.ok) throw new Error(`Access check failed with HTTP ${response.status}.`)
            const body = await response.json()
            if (body?.allowed === true) {
                setAccessStatus('allowed')
                return
            }
            if (body?.allowed === false) {
                setAccessStatus('blocked')
                return
            }
            throw new Error('Access check returned an invalid response.')
        } catch {
            setAccessStatus('unavailable')
        }
    }, [])

    useEffect(() => {
        void checkAccess()
    }, [checkAccess])

    if (accessStatus !== 'allowed') {
        return <AccessGatePage status={accessStatus} onRetry={checkAccess} />
    }

    return children
}

/**
 * Blocks the hosted application before wallet, quote, or transaction features
 * mount. Broad Vitest integration suites bypass this boundary synchronously;
 * focused gate tests opt back in with `enforce`.
 */
export default function HostedAccessGate({
    children,
    enforce = import.meta.env.MODE !== 'test',
}) {
    if (!enforce) return children
    return <EnforcedHostedAccessGate>{children}</EnforcedHostedAccessGate>
}
