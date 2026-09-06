from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    file_path.write_text(text.replace(old, new, 1))


# 1) When a passkey is removed from Pistachio Wallet, also use the WebAuthn
# credential synchronization API when the browser supports it. This asks the
# browser/password manager to remove the now-unknown discoverable credential.
replace_once(
    "src/features/passkey/services/walletUIOperations.js",
    """async function revealWorkerSecret(method, field, fallback) {
    // Lightweight test/dev manager doubles do not expose the worker client.
    // Preserve the old public manager behavior for those implementations.
    if (!canUseRecoveryRevealGracePath()) return fallback()

    await ensureRecoveryRevealAuthorization()
    const result = await manager.client.request(method)
    const secret = result?.[field]
    if (typeof secret !== 'string' || !secret) {
        const error = new Error('Pistachio Wallet did not return the requested recovery secret.')
        error.code = 'PISTACHIO_RECOVERY_SECRET_UNAVAILABLE'
        throw error
    }
    await manager.recordActivity?.()
    return secret
}

const overrides = Object.freeze({
""",
    """async function revealWorkerSecret(method, field, fallback) {
    // Lightweight test/dev manager doubles do not expose the worker client.
    // Preserve the old public manager behavior for those implementations.
    if (!canUseRecoveryRevealGracePath()) return fallback()

    await ensureRecoveryRevealAuthorization()
    const result = await manager.client.request(method)
    const secret = result?.[field]
    if (typeof secret !== 'string' || !secret) {
        const error = new Error('Pistachio Wallet did not return the requested recovery secret.')
        error.code = 'PISTACHIO_RECOVERY_SECRET_UNAVAILABLE'
        throw error
    }
    await manager.recordActivity?.()
    return secret
}

async function removePasskeyAndSyncCredentialManager(keyWrapId) {
    const snapshot = manager.snapshot()
    const keyWrap = snapshot?.vault?.keyWraps?.find((candidate) =>
        candidate?.id === keyWrapId)
    const result = await manager.removePasskey(keyWrapId)

    // WebAuthn does not expose a generic imperative delete API. The Level 3
    // Signal API is the standards-based way for an RP to tell a credential
    // manager that a discoverable credential is no longer accepted. Supporting
    // authenticators/password managers can then remove it from their UI/store.
    const PublicKeyCredentialImpl = globalThis.PublicKeyCredential
    const signalUnknownCredential = PublicKeyCredentialImpl?.signalUnknownCredential
    if (
        keyWrap?.credentialId &&
        keyWrap?.rpId &&
        typeof signalUnknownCredential === 'function'
    ) {
        try {
            await signalUnknownCredential.call(PublicKeyCredentialImpl, {
                rpId: keyWrap.rpId,
                credentialId: keyWrap.credentialId,
            })
        } catch (error) {
            console.warn(
                '[pistachio-wallet] Credential manager did not remove the retired passkey.',
                error,
            )
        }
    }

    return result
}

const overrides = Object.freeze({
    removePasskey: removePasskeyAndSyncCredentialManager,
""",
    "passkey credential-manager synchronization",
)

replace_once(
    "src/features/passkey/components/wallet/WalletSecurityPanels.jsx",
    """                <p id={`${id}-remove-help`}>{snapshot.vault.keyWraps.length === 1 ? 'Your only passkey cannot be removed. Add another passkey first.' : !snapshot.recoveryBackupConfirmed ? 'Another passkey will remain after removal. Keep an offline recovery backup too.' : 'Removing access here does not delete the passkey from your browser, device, or password manager.'}</p>
""",
    """                <p id={`${id}-remove-help`}>{snapshot.vault.keyWraps.length === 1 ? 'Your only passkey cannot be removed. Add another passkey first.' : !snapshot.recoveryBackupConfirmed ? 'Another passkey will remain after removal. Keep an offline recovery backup too.' : 'Removing this passkey also asks supported browsers and password managers to remove the saved credential.'}</p>
""",
    "passkey removal help copy",
)

# Add a manager double for the new UI removal wrapper and verify the Signal API
# receives the exact credential that was retired.
replace_once(
    "src/features/passkey/services/walletUIOperations.test.js",
    """        recordActivity: vi.fn(async () => undefined),
        requireUnlocked: vi.fn(function requireUnlocked() {
""",
    """        recordActivity: vi.fn(async () => undefined),
        removePasskey: vi.fn(async () => undefined),
        requireUnlocked: vi.fn(function requireUnlocked() {
""",
    "wallet UI manager removePasskey mock",
)

replace_once(
    "src/features/passkey/services/walletUIOperations.test.js",
    """        mocks.manager.recordActivity.mockClear()
        mocks.manager.requireUnlocked.mockClear()
    })
""",
    """        mocks.manager.recordActivity.mockClear()
        mocks.manager.removePasskey.mockReset()
        mocks.manager.removePasskey.mockResolvedValue(undefined)
        mocks.manager.requireUnlocked.mockClear()
    })
""",
    "wallet UI removePasskey mock reset",
)

replace_once(
    "src/features/passkey/services/walletUIOperations.test.js",
    """    it('does not reuse a recent timestamp if decrypted worker state is unavailable', async () => {
""",
    """    it('asks a supporting credential manager to remove a retired passkey', async () => {
        const signalUnknownCredential = vi.fn(async () => undefined)
        const previousDescriptor = Object.getOwnPropertyDescriptor(
            globalThis,
            'PublicKeyCredential',
        )
        Object.defineProperty(globalThis, 'PublicKeyCredential', {
            configurable: true,
            value: { signalUnknownCredential },
        })
        mocks.state.snapshot = {
            lastUnlockByWrap: {},
            vault: {
                ...vault,
                keyWraps: [
                    {
                        id: 'wrap-1',
                        credentialId: 'AQ',
                        rpId: 'pistachioswap.com',
                    },
                    {
                        id: 'wrap-2',
                        credentialId: 'Ag',
                        rpId: 'pistachioswap.com',
                    },
                ],
            },
        }

        try {
            await walletUIOperations.removePasskey('wrap-1')
            expect(mocks.manager.removePasskey).toHaveBeenCalledWith('wrap-1')
            expect(signalUnknownCredential).toHaveBeenCalledWith({
                rpId: 'pistachioswap.com',
                credentialId: 'AQ',
            })
        } finally {
            if (previousDescriptor) {
                Object.defineProperty(
                    globalThis,
                    'PublicKeyCredential',
                    previousDescriptor,
                )
            } else {
                delete globalThis.PublicKeyCredential
            }
        }
    })

    it('does not reuse a recent timestamp if decrypted worker state is unavailable', async () => {
""",
    "wallet UI Signal API regression",
)

# 2) Normal routed swaps often arrive from Moralis labelled as generic Send or
# contract interaction. Infer a swap from an unambiguous user-initiated contract
# flow: one outgoing asset identity and one different incoming asset identity.
# Self-calls remain excluded so arbitrary EIP-7702/self interactions do not get
# promoted without a known Pistachio authorization/contract match.
replace_once(
    "apps/api/src/modules/wallet-activity.ts",
    """function decodeApprovalActivity({
""",
    """function inferUserInitiatedSwapActivity({
    chainId,
    wallet,
    value,
    hash,
    timestamp,
    outgoing,
    incoming,
}: {
    chainId: number
    wallet: string
    value: Record<string, unknown>
    hash: string
    timestamp: string | null
    outgoing: Transfer[]
    incoming: Transfer[]
}): Record<string, unknown> | null {
    if (normalizeAddress(value.from_address) !== wallet) return null
    const to = normalizeAddress(value.to_address)
    const input = stringValue(value.input, 200_000)
    if (!to || to === wallet || !input || !isHex(input) || input === '0x') return null

    const sell = singleTokenFlow(outgoing)
    const buy = singleTokenFlow(incoming)
    if (!sell || !buy || tokenIdentity(sell.token) === tokenIdentity(buy.token)) {
        return null
    }

    return {
        id: `${chainId}:${hash}`,
        walletAddress: wallet,
        type: 'swapped',
        chainId,
        hash,
        timestamp,
        sellToken: sell.token,
        buyToken: buy.token,
        sellAmount: sell.amount,
        buyAmount: buy.amount,
        recipient: to,
        provider: 'onchain-flow',
    }
}

function decodeApprovalActivity({
""",
    "normal swap flow inference helper",
)

replace_once(
    "apps/api/src/modules/wallet-activity.ts",
    """    if (
        swapSemantic &&
        sell && buy && tokenIdentity(sell.token) !== tokenIdentity(buy.token)
    ) {
        return {
            id: `${chainId}:${hash}`,
            walletAddress: wallet,
            type: 'swapped',
            chainId,
            hash,
            timestamp,
            sellToken: sell.token,
            buyToken: buy.token,
            sellAmount: sell.amount,
            buyAmount: buy.amount,
            recipient: to,
        }
    }

    if (outgoing.length > 0 || from === wallet) {
""",
    """    if (
        swapSemantic &&
        sell && buy && tokenIdentity(sell.token) !== tokenIdentity(buy.token)
    ) {
        return {
            id: `${chainId}:${hash}`,
            walletAddress: wallet,
            type: 'swapped',
            chainId,
            hash,
            timestamp,
            sellToken: sell.token,
            buyToken: buy.token,
            sellAmount: sell.amount,
            buyAmount: buy.amount,
            recipient: to,
        }
    }

    const inferredSwap = inferUserInitiatedSwapActivity({
        chainId,
        wallet,
        value,
        hash,
        timestamp,
        outgoing,
        incoming,
    })
    if (inferredSwap) return inferredSwap

    if (outgoing.length > 0 || from === wallet) {
""",
    "normal swap flow inference call",
)

replace_once(
    "apps/api/src/modules/wallet-activity.ts",
    """    inferKnownPistachioSwapActivity,
    isKnownPistachioBscContract,
""",
    """    inferKnownPistachioSwapActivity,
    inferUserInitiatedSwapActivity,
    isKnownPistachioBscContract,
""",
    "normal swap inference internals export",
)

# Regression proving a normal non-Gas-Assist router call remains a swap even
# when the history provider merely calls the transaction Send.
replace_once(
    "apps/api/test/wallet-activity.test.ts",
    """    it('does not promote an arbitrary self-call with token movement into a swap', async () => {
""",
    """    it('recognizes a normal routed swap from token flow even when the provider labels it Send', async () => {
        mocks.getWalletTokens.mockResolvedValue([
            token(realBscUsdtAddress),
            token(wbnbAddress, { name: 'Wrapped BNB', symbol: 'WBNB' }),
        ])
        mocks.moralisWalletHistoryRequest.mockResolvedValue({
            result: [historyRow({
                hash: '450',
                summary: 'Send',
                category: 'contract interaction',
                input: '0x12345678',
                fromAddress: wallet,
                toAddress: router,
                transfers: [
                    erc20Transfer(realBscUsdtAddress, 'outgoing', false, {
                        to_address: router,
                    }),
                    erc20Transfer(wbnbAddress, 'incoming', false, {
                        from_address: router,
                    }),
                ],
            })],
        })

        const app = createApp()
        const response = await app.inject({
            method: 'GET',
            url: `/v1/wallet-activity?address=${wallet}&chainIds=56&limit=20`,
        })
        await app.close()

        expect(response.statusCode).toBe(200)
        expect(response.json().items).toHaveLength(1)
        expect(response.json().items[0]).toMatchObject({
            type: 'swapped',
            provider: 'onchain-flow',
            sellAmount: '1',
            buyAmount: '1',
            sellToken: expect.objectContaining({ symbol: 'USDT' }),
            buyToken: expect.objectContaining({ symbol: 'WBNB' }),
        })
    })

    it('does not promote an arbitrary self-call with token movement into a swap', async () => {
""",
    "normal routed swap regression",
)

# 3) Local activity knows what Pistachio actually submitted. Merge local and
# remote history by transaction hash instead of by hash+type, and prefer the
# richer semantic type so a provider's generic "sent" row cannot override a
# locally-confirmed swap or produce a duplicate row.
replace_once(
    "src/features/wallet/hooks/useWalletActivity.js",
    """function activityKey(item) {
    return item?.hash
        ? `${Number(item.chainId)}:${String(item.hash).toLowerCase()}:${String(item.type)}`
        : String(item?.id ?? '')
}
""",
    """const ACTIVITY_TYPE_RANK = Object.freeze({
    contract: 0,
    received: 1,
    sent: 2,
    approved: 3,
    swapped: 4,
})

function activityKey(item) {
    return item?.hash
        ? `${Number(item.chainId)}:${String(item.hash).toLowerCase()}`
        : String(item?.id ?? '')
}

function mergeActivity(existing, item) {
    if (!existing) return item
    const existingRank = ACTIVITY_TYPE_RANK[existing.type] ?? -1
    const itemRank = ACTIVITY_TYPE_RANK[item.type] ?? -1
    const primary = itemRank >= existingRank ? item : existing
    const secondary = primary === item ? existing : item
    return {
        ...secondary,
        ...primary,
        token: primary.token ?? secondary.token ?? null,
        sellToken: primary.sellToken ?? secondary.sellToken ?? null,
        buyToken: primary.buyToken ?? secondary.buyToken ?? null,
        amount: primary.amount ?? secondary.amount ?? null,
        sellAmount: primary.sellAmount ?? secondary.sellAmount ?? null,
        buyAmount: primary.buyAmount ?? secondary.buyAmount ?? null,
        recipient: primary.recipient ?? secondary.recipient ?? null,
    }
}
""",
    "wallet activity transaction-key merge",
)

replace_once(
    "src/features/wallet/hooks/useWalletActivity.js",
    """        for (const item of [...localItems, ...remoteItems]) {
            const key = activityKey(item)
            if (!key) continue
            const existing = merged.get(key)
            merged.set(key, existing ? {
                ...existing,
                ...item,
                token: item.token ?? existing.token ?? null,
                sellToken: item.sellToken ?? existing.sellToken ?? null,
                buyToken: item.buyToken ?? existing.buyToken ?? null,
                amount: item.amount ?? existing.amount ?? null,
                sellAmount: item.sellAmount ?? existing.sellAmount ?? null,
                buyAmount: item.buyAmount ?? existing.buyAmount ?? null,
                recipient: item.recipient ?? existing.recipient ?? null,
            } : item)
        }
""",
    """        for (const item of [...remoteItems, ...localItems]) {
            const key = activityKey(item)
            if (!key) continue
            merged.set(key, mergeActivity(merged.get(key), item))
        }
""",
    "wallet activity merge implementation",
)

replace_once(
    "src/features/wallet/hooks/useWalletActivity.test.jsx",
    """const mocks = vi.hoisted(() => ({
    fetchWalletHistory: vi.fn(),
}))
""",
    """const mocks = vi.hoisted(() => ({
    fetchWalletHistory: vi.fn(),
    localItems: [],
}))
""",
    "wallet activity test local items state",
)

replace_once(
    "src/features/wallet/hooks/useWalletActivity.test.jsx",
    """    readWalletActivity: () => [],
""",
    """    readWalletActivity: () => mocks.localItems,
""",
    "wallet activity test local reader",
)

replace_once(
    "src/features/wallet/hooks/useWalletActivity.test.jsx",
    """    afterEach(() => {
        vi.clearAllMocks()
    })
""",
    """    afterEach(() => {
        vi.clearAllMocks()
        mocks.localItems = []
    })
""",
    "wallet activity test local reset",
)

replace_once(
    "src/features/wallet/hooks/useWalletActivity.test.jsx",
    """    it('keeps history from successful batches when another batch fails', async () => {
""",
    """    it('deduplicates a transaction by hash and keeps local swap semantics over a generic remote send', async () => {
        const hash = `0x${'42'.repeat(32)}`
        mocks.localItems = [{
            id: 'local-swap',
            walletAddress,
            type: 'swapped',
            chainId: 56,
            hash,
            timestamp: '2026-09-06T12:00:00.000Z',
            sellToken: null,
            buyToken: null,
        }]
        mocks.fetchWalletHistory.mockImplementation(async ({ chainIds }) => ({
            items: chainIds.includes(56) ? [{
                id: 'remote-send',
                walletAddress,
                type: 'sent',
                chainId: 56,
                hash,
                timestamp: '2026-09-06T12:00:00.000Z',
                token: { symbol: 'USDT' },
                amount: '1',
            }] : [],
        }))

        const { result } = renderHook(() => useWalletActivity({
            walletAddress,
            limit: 50,
        }))

        await waitFor(() => expect(result.current.loading).toBe(false))

        expect(result.current.items).toHaveLength(1)
        expect(result.current.items[0]).toMatchObject({
            type: 'swapped',
            hash,
            token: { symbol: 'USDT' },
            amount: '1',
        })
    })

    it('keeps history from successful batches when another batch fails', async () => {
""",
    "wallet activity local semantic merge regression",
)

print('Passkey deletion sync and wallet activity fixes applied.')
