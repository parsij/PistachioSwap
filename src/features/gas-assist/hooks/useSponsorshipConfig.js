import { useCallback, useEffect, useState } from 'react'

import { fetchSponsorshipConfig } from '../services/prepaidSponsorship.js'

const cache = new Map()
const idle = { status: 'idle', config: null, error: null }

function loadConfig(quoteEndpoint, chainId) {
    const cached = cache.get(`${quoteEndpoint}:${chainId}`)
    if (cached?.config) return Promise.resolve(cached.config)
    if (cached?.promise) return cached.promise
    const promise = fetchSponsorshipConfig(quoteEndpoint, undefined, chainId)
        .then((config) => {
            cache.set(`${quoteEndpoint}:${chainId}`, { config })
            return config
        })
        .catch((error) => {
            cache.delete(`${quoteEndpoint}:${chainId}`)
            throw error
        })
    cache.set(`${quoteEndpoint}:${chainId}`, { promise })
    return promise
}

/**
 * Loads the backend-authoritative prepaid sponsorship configuration for low-BNB routing.
 */
export function useSponsorshipConfig({ quoteEndpoint, enabled, chainId = 56 }) {
    const [refreshIndex, setRefreshIndex] = useState(0)
    const [state, setState] = useState(idle)

    useEffect(() => {
        if (!enabled || !quoteEndpoint) {
            setState(idle)
            return undefined
        }
        let active = true
        const cached = cache.get(`${quoteEndpoint}:${chainId}`)?.config
        if (cached) {
            setState({ status: 'success', config: cached, error: null })
            return () => { active = false }
        }
        setState({ status: 'loading', config: null, error: null })
        loadConfig(quoteEndpoint, chainId)
            .then((config) => {
                if (active) setState({ status: 'success', config, error: null })
            })
            .catch((error) => {
                if (active) setState({ status: 'error', config: null, error })
            })
        return () => { active = false }
    }, [enabled, quoteEndpoint, chainId, refreshIndex])

    const refetch = useCallback(() => {
        if (quoteEndpoint) cache.delete(`${quoteEndpoint}:${chainId}`)
        setRefreshIndex((value) => value + 1)
    }, [quoteEndpoint, chainId])

    return { ...state, refetch }
}

export const sponsorshipConfigInternals = {
    clearCache: () => cache.clear(),
}
