import { useCallback, useEffect, useRef, useState } from 'react'

import { screenComplianceAccess } from '../services/compliance.js'

export function useComplianceAccess({ endpoint, walletAddress, chainId }) {
    const [state, setState] = useState({
        status: walletAddress ? 'checking' : 'idle',
        allowed: !walletAddress,
        expiresAt: null,
        error: null,
    })
    const cacheRef = useRef(null)

    const check = useCallback(async ({ force = false, purpose = 'background' } = {}) => {
        if (!walletAddress) {
            const clear = { status: 'idle', allowed: true, expiresAt: null, error: null }
            setState(clear)
            return clear
        }
        const key = `${String(walletAddress).toLowerCase()}:${Number(chainId) || 0}`
        const cached = cacheRef.current
        if (
            !force && cached?.key === key &&
            Date.parse(cached.result.expiresAt ?? '') > Date.now() + 2_000
        ) {
            return cached.result
        }
        const controller = new AbortController()
        setState((current) => ({ ...current, status: 'checking', error: null }))
        try {
            const result = await screenComplianceAccess({
                endpoint,
                walletAddress,
                chainId,
                purpose,
                signal: controller.signal,
            })
            cacheRef.current = { key, result }
            setState({
                status: result.allowed ? 'allowed' : 'blocked',
                allowed: result.allowed,
                expiresAt: result.expiresAt,
                error: null,
            })
            return result
        } catch (error) {
            setState({
                status: error?.code === 'COMPLIANCE_RESTRICTED' ? 'blocked' : 'unavailable',
                allowed: false,
                expiresAt: null,
                error,
            })
            throw error
        }
    }, [chainId, endpoint, walletAddress])

    useEffect(() => {
        if (!walletAddress) {
            cacheRef.current = null
            setState({ status: 'idle', allowed: true, expiresAt: null, error: null })
            return
        }
        void check().catch(() => undefined)
    }, [check, walletAddress])

    const ensureAllowed = useCallback(async () => {
        const result = await check({ force: true, purpose: 'transaction' })
        if (!result.allowed) {
            const error = new Error('PistachioSwap cannot provide transaction services for this wallet.')
            error.code = 'COMPLIANCE_RESTRICTED'
            throw error
        }
        return result
    }, [check])

    return { ...state, check, ensureAllowed }
}
