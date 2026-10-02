import { useCallback, useEffect, useState } from 'react'

import { fetchSponsorshipConfig } from '../services/prepaidSponsorship.js'

const cache = new Map()
const idle = { status: 'idle', config: null, error: null }

function loadConfig(quoteEndpoint) {
    const cached = cache.get(quoteEndpoint)
    if (cached?.config) return Promise.resolve(cached.config)
    if (cached?.promise) return cached.promise
    const promise = fetchSponsorshipConfig(quoteEndpoint)
        .then((config) => {
            cache.set(quoteEndpoint, { config })
            return config
        })
        .catch((error) => {
            cache.delete(quoteEndpoint)
            throw error
        })
    cache.set(quoteEndpoint, { promise })
    return promise
}

/**
 * Loads the backend-authoritative prepaid sponsorship configuration for low-BNB routing.
 */
export function useSponsorshipConfig({ quoteEndpoint, enabled }) {
    const [refreshIndex, setRefreshIndex] = useState(0)
    const [state, setState] = useState(idle)

    useEffect(() => {
        if (!enabled || !quoteEndpoint) {
            setState(idle)
            return undefined
        }
        let active = true
        const cached = cache.get(quoteEndpoint)?.config
        if (cached) {
            setState({ status: 'success', config: cached, error: null })
            return () => { active = false }
        }
        setState({ status: 'loading', config: null, error: null })
        loadConfig(quoteEndpoint)
            .then((config) => {
                if (active) setState({ status: 'success', config, error: null })
            })
            .catch((error) => {
                if (active) setState({ status: 'error', config: null, error })
            })
        return () => { active = false }
    }, [enabled, quoteEndpoint, refreshIndex])

    const refetch = useCallback(() => {
        if (quoteEndpoint) cache.delete(quoteEndpoint)
        setRefreshIndex((value) => value + 1)
    }, [quoteEndpoint])

    return { ...state, refetch }
}

export const sponsorshipConfigInternals = {
    clearCache: () => cache.clear(),
}
