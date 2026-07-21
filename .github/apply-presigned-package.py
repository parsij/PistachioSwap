from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


def replace(path: str, old: str, new: str, expected: int = 1) -> None:
    text = read(path)
    count = text.count(old)
    if count != expected:
        raise SystemExit(
            f"{path}: expected {expected} occurrences, found {count}: {old[:120]!r}"
        )
    write(path, text.replace(old, new))


# Package service uses a browserless submitter that preserves stored abuse scopes.
replace(
    "apps/api/src/gas-assist/prepaid/package-service.ts",
    "import { createSponsorshipIntentService } from './intent-service.js'\n",
    "import { createSponsorshipIntentService } from './intent-service.js'\n"
    "import { createStoredIntentSubmitter } from './stored-intent-submitter.js'\n",
)
replace(
    "apps/api/src/gas-assist/prepaid/package-service.ts",
    "    const intentService = createSponsorshipIntentService({ database })\n",
    "    const intentService = createSponsorshipIntentService({ database })\n"
    "    const storedIntentSubmitter = createStoredIntentSubmitter(database)\n",
)
old_submit = """            const result = await intentService.submit({
                intentId: intent.id,
                signedRawTransaction: intent.signedRawTransaction,
                walletAddress: order.walletAddress,
                ...(clientIp
                    ? { clientIp }
                    : { trustedIpHash: order.ipHash }),
            })"""
new_submit = """            const result = await storedIntentSubmitter.submit({
                intentId: intent.id,
                walletAddress: order.walletAddress,
            })"""
replace(
    "apps/api/src/gas-assist/prepaid/package-service.ts",
    old_submit,
    new_submit,
)
replace(
    "apps/api/src/gas-assist/prepaid/package-service.ts",
    """    return {
        prepare,
        storeSignedPackage,
        submitSignedPackage,
        advanceOrder,
        advancePendingPackages,
    }
}""",
    """    async function getState(orderId: string, walletAddress: string) {
        const intents = await loadIntents(database, orderId, walletAddress)
        const signedActions = new Set(
            intents
                .filter((intent) => Boolean(intent.signedRawTransaction))
                .map((intent) => intent.action),
        )
        return {
            preSignedPackage: PACKAGE_ACTIONS.every((action) =>
                signedActions.has(action)),
        }
    }

    return {
        prepare,
        storeSignedPackage,
        submitSignedPackage,
        advanceOrder,
        advancePendingPackages,
        getState,
    }
}""",
)

# The order endpoint suppresses later wallet prompts once all three raws exist.
replace(
    "apps/api/src/modules/sponsorship.ts",
    """            const refreshed = await intents().refreshOrder(request.params.orderId, session.walletAddress)
            return {
                ...(await orders().get(request.params.orderId, session.walletAddress)),
                currentRequiredAction: refreshed.currentRequiredAction,
                confirmationCount: refreshed.confirmationCount,
                preSignedPackage: refreshed.preSignedPackage ?? false,
            }""",
    """            const refreshed = await intents().refreshOrder(request.params.orderId, session.walletAddress)
            const packageState = await packages().getState(
                request.params.orderId,
                session.walletAddress,
            )
            return {
                ...(await orders().get(request.params.orderId, session.walletAddress)),
                currentRequiredAction: packageState.preSignedPackage
                    ? 'wait-backend-execution'
                    : refreshed.currentRequiredAction,
                confirmationCount: refreshed.confirmationCount,
                preSignedPackage: packageState.preSignedPackage,
            }""",
)

# Always force the post-payment grant to fifteen minutes, even when older code
# supplies a shorter value in the UPDATE statement.
replace(
    "apps/api/drizzle/0006_presigned_package_fifteen_minute_expiry.sql",
    """    NEW.grant_expires_at := COALESCE(
      NEW.grant_expires_at,
      NEW.fee_confirmed_at + interval '15 minutes'
    );
    NEW.expires_at := NEW.grant_expires_at;""",
    """    NEW.grant_expires_at :=
      NEW.fee_confirmed_at + interval '15 minutes';
    NEW.expires_at := NEW.grant_expires_at;""",
)

# Fifteen-minute defaults for newly created orders and signing intents.
replace(
    "apps/api/src/config.ts",
    """            orderTtlSeconds: readConfiguredInteger(
                'MEGAFUEL_ORDER_TTL_SECONDS',
                300,
                60,
                300,
            ),""",
    """            orderTtlSeconds: readConfiguredInteger(
                'MEGAFUEL_ORDER_TTL_SECONDS',
                900,
                60,
                900,
            ),""",
)
replace(
    "apps/api/src/config.ts",
    """            actionIntentTtlSeconds: readConfiguredInteger(
                'MEGAFUEL_ACTION_INTENT_TTL_SECONDS',
                300,
                60,
                300,
            ),""",
    """            actionIntentTtlSeconds: readConfiguredInteger(
                'MEGAFUEL_ACTION_INTENT_TTL_SECONDS',
                900,
                60,
                900,
            ),""",
)
replace(
    "apps/api/.env.megafuel.example",
    """# The payment quote expires in two minutes. After exact payment confirmation,
# migration 0004 opens a fresh five-minute approval/swap grant.
MEGAFUEL_ORDER_TTL_SECONDS=120
MEGAFUEL_ACTION_INTENT_TTL_SECONDS=90""",
    """# The order, all three signing intents, and the post-payment grant use a
# fifteen-minute lifetime.
MEGAFUEL_ORDER_TTL_SECONDS=900
MEGAFUEL_ACTION_INTENT_TTL_SECONDS=900""",
)
replace(
    "apps/api/.env.megafuel.example",
    """# EXTREMELY DANGEROUS. When true, a whitelisted payment token bypasses security,
# liquidity, transfer-behavior, price-age, and price-deviation gates. Mechanical
# requirements such as whitelist enablement, valid decimals, positive billing price,
# and sufficient wallet balance still apply. Never enable this in production.""",
    """# EXTREMELY DANGEROUS. Whitelisted tokens already bypass third-party security and
# transfer simulation. This switch additionally bypasses live liquidity, price-age,
# and price-deviation gates. Never enable this in production.""",
)

# The Uniswap API must build calldata with the real deadline; changing only a
# database timestamp would be decorative rather than correct.
replace(
    "apps/api/src/features/quotes/providers/uniswap-provider.ts",
    "    futureExpiry,\n",
    "",
)
replace(
    "apps/api/src/features/quotes/providers/uniswap-provider.ts",
    """const UNISWAP_UNIVERSAL_ROUTER_VERSION = '2.0'
const BPS_DENOMINATOR = 10_000n""",
    """const UNISWAP_UNIVERSAL_ROUTER_VERSION = '2.0'
const UNISWAP_TRANSACTION_TTL_SECONDS = 15 * 60
const BPS_DENOMINATOR = 10_000n""",
)
replace(
    "apps/api/src/features/quotes/providers/uniswap-provider.ts",
    "            const swapPayload = await fetchJson(\n",
    """            const swapDeadline = Math.floor(Date.now() / 1_000) +
                UNISWAP_TRANSACTION_TTL_SECONDS
            const swapPayload = await fetchJson(
""",
)
replace(
    "apps/api/src/features/quotes/providers/uniswap-provider.ts",
    """                    body: {
                        quote: quotePayload.quote,
                    },""",
    """                    body: {
                        quote: quotePayload.quote,
                        deadline: swapDeadline,
                    },""",
)
replace(
    "apps/api/src/features/quotes/providers/uniswap-provider.ts",
    """                expiresAt:
                    futureExpiry(30),""",
    """                expiresAt:
                    new Date(swapDeadline * 1_000).toISOString(),""",
)

# Frontend package HTTP helpers.
replace(
    "src/features/gas-assist/services/prepaidSponsorship.js",
    "/** Fetches the current server-authoritative state of one prepaid sponsorship order. */\n",
    """/** Requests all three exact transactions before any transaction is broadcast. */
export function prepareSponsorshipPackage(quoteEndpoint, sessionToken, orderId, signal) {
    return post(quoteEndpoint, `/v1/sponsorship/orders/${encodeURIComponent(orderId)}/package/prepare`, {}, { sessionToken, signal })
}

/** Atomically stores all three signed raw transactions before backend execution. */
export function submitSponsorshipPackage(quoteEndpoint, sessionToken, orderId, signedTransactions, signal) {
    return post(quoteEndpoint, `/v1/sponsorship/orders/${encodeURIComponent(orderId)}/package/submit`, { signedTransactions }, { sessionToken, signal })
}

/** Fetches the current server-authoritative state of one prepaid sponsorship order. */
""",
)

# Frontend signing orchestration. A partial package is never submitted.
replace(
    "src/features/gas-assist/services/rawTransactionSigning.js",
    "export const rawSigningInternals = {\n",
    """export async function signPreparedSponsoredPackage({
    transport,
    capability,
    walletClient,
    preparedPackage,
    authenticatedWalletAddress,
    multichainAccount,
    submitSignedPackage,
}) {
    const expectedActions = [
        'fee-payment-transfer',
        'token-approval',
        'normal-swap',
    ]
    if (transport !== 'pistachio-local' ||
        typeof submitSignedPackage !== 'function' ||
        !Array.isArray(preparedPackage?.transactions) ||
        preparedPackage.transactions.length !== expectedActions.length) {
        const error = new Error('The prepared Gas Assist package is invalid.')
        error.code = 'SPONSORSHIP_PACKAGE_INVALID'
        throw error
    }
    const byAction = new Map(
        preparedPackage.transactions.map((item) => [item.action, item]),
    )
    if (byAction.size !== expectedActions.length ||
        expectedActions.some((action) => !byAction.has(action))) {
        const error = new Error('The prepared Gas Assist package is incomplete.')
        error.code = 'SPONSORSHIP_PACKAGE_INVALID'
        throw error
    }

    const signedTransactions = []
    try {
        for (const action of expectedActions) {
            const intent = byAction.get(action)
            const normalizedTransaction = normalizePreparedSponsoredTransaction(
                intent.transaction,
                authenticatedWalletAddress,
            )
            const signedRawTransaction = await signRawSponsoredTransaction({
                capability,
                walletClient,
                transaction: normalizedTransaction,
            })
            await validateSignedPreparedTransaction({
                signedRawTransaction,
                normalizedTransaction,
                authenticatedWalletAddress,
                multichainAccount: multichainAccount ?? authenticatedWalletAddress,
            })
            signedTransactions.push({
                intentId: intent.intentId,
                action,
                signedRawTransaction,
            })
        }
        return await submitSignedPackage(signedTransactions)
    } finally {
        signedTransactions.splice(0, signedTransactions.length)
    }
}

export const rawSigningInternals = {
""",
)

# Hook package preparation and signing into the existing controller.
hook = read("src/features/gas-assist/hooks/usePrepaidSponsorship.js")
hook = hook.replace(
    "    prepareSponsorshipPayment,\n    submitSponsorshipIntent,",
    "    prepareSponsorshipPayment,\n    prepareSponsorshipPackage,\n    submitSponsorshipIntent,\n    submitSponsorshipPackage,",
)
hook = hook.replace(
    "    signPreparedSponsoredTransaction,\n",
    "    signPreparedSponsoredTransaction,\n    signPreparedSponsoredPackage,\n",
)
marker = "    const requestContinuation = useCallback(async () => {\n"
if hook.count(marker) != 1:
    raise SystemExit("usePrepaidSponsorship requestContinuation marker missing")
sign_package = """    const signPackage = useCallback(async () => {
        const order = state.order
        const sessionToken = sessionTokenRef.current
        const walletEpoch = walletEpochRef.current
        if (!order || !sessionToken || !walletClient || !walletAddress) return
        try {
            setState((current) => ({ ...current, phase: 'package-preparing', error: null }))
            const preparedPackage = await prepareSponsorshipPackage(
                quoteEndpoint,
                sessionToken,
                order.id,
            )
            setState((current) => ({
                ...current,
                phase: 'package-signing',
                intentExpiresAt: preparedPackage.expiresAt,
            }))
            await signPreparedSponsoredPackage({
                transport: capability.transport,
                capability,
                walletClient,
                preparedPackage,
                authenticatedWalletAddress: walletAddress,
                multichainAccount: walletAddress,
                submitSignedPackage: async (signedTransactions) => {
                    if (walletEpochRef.current !== walletEpoch) {
                        const error = new Error('The connected wallet changed during package signing.')
                        error.code = 'PISTACHIO_ACCOUNT_MISMATCH'
                        throw error
                    }
                    if (Date.parse(preparedPackage.expiresAt) <= Date.now()) {
                        const error = new Error('The signed transaction package expired.')
                        error.code = 'INTENT_EXPIRED'
                        throw error
                    }
                    return submitSponsorshipPackage(
                        quoteEndpoint,
                        sessionToken,
                        order.id,
                        signedTransactions,
                    )
                },
            })
            setState((current) => ({
                ...current,
                phase: 'payment-confirming',
                intentExpiresAt: null,
                order: { ...current.order, preSignedPackage: true },
            }))
        } catch (error) {
            setState((current) => ({
                ...current,
                phase: isUserRejectedError(error) ? 'cancelled' : 'failed',
                intentExpiresAt: null,
                error,
            }))
        }
    }, [capability, quoteEndpoint, state.order, walletAddress, walletClient])

"""
hook = hook.replace(marker, sign_package + marker)
if hook.count("        signPayment: () => signIntent('payment'),\n") != 1:
    raise SystemExit("usePrepaidSponsorship return marker missing")
hook = hook.replace(
    "        signPayment: () => signIntent('payment'),\n",
    "        signPackage,\n        signPayment: () => signIntent('payment'),\n",
)
write("src/features/gas-assist/hooks/usePrepaidSponsorship.js", hook)

# Dialog uses one explicit review action and explains durable sequencing.
replace(
    "src/features/gas-assist/components/GasAssistPrepaymentDialog.jsx",
    """                                <span>The approval is not prepared until the treasury confirms the exact payment amount.</span>
                                <span>Payment, approval, and swap are separate transactions and are not atomic.</span>""",
    """                                <span>Pistachio Wallet signs payment, exact approval, and swap before the first broadcast.</span>
                                <span>The backend stores all three raw transactions first, then broadcasts them sequentially after each on-chain confirmation.</span>""",
)
replace(
    "src/features/gas-assist/components/GasAssistPrepaymentDialog.jsx",
    """                    {sponsorship.phase === 'payment-signing' && <p className="gas-assist-status" role="status">Confirm the exact payment transaction in Pistachio Wallet.</p>}""",
    """                    {sponsorship.phase === 'package-signing' && <p className="gas-assist-status" role="status">Confirm the payment, exact approval, and swap transactions. Nothing is broadcast until all three are stored.</p>}
                    {sponsorship.phase === 'payment-signing' && <p className="gas-assist-status" role="status">Confirm the exact payment transaction in Pistachio Wallet.</p>}""",
)
replace(
    "src/features/gas-assist/components/GasAssistPrepaymentDialog.jsx",
    """                    {!orderExpired && showPayment && (
                        <button className="gas-assist-primary" type="button" onClick={sponsorship.signPayment} disabled={busy}>
                            Sign exact payment transaction
                        </button>
                    )}""",
    """                    {!orderExpired && showPayment && sponsorship.signPackage && (
                        <button className="gas-assist-primary" type="button" onClick={sponsorship.signPackage} disabled={busy}>
                            Sign payment, approval, and swap
                        </button>
                    )}
                    {!orderExpired && showPayment && !sponsorship.signPackage && (
                        <button className="gas-assist-primary" type="button" onClick={sponsorship.signPayment} disabled={busy}>
                            Sign exact payment transaction
                        </button>
                    )}""",
)

# Package signer tests.
write(
    "src/features/gas-assist/services/rawTransactionSigning.package.test.js",
    """import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./metamaskMultichain.js', () => ({
    normalizePreparedSponsoredTransaction: (transaction) => transaction,
    validateSignedPreparedTransaction: vi.fn(async () => undefined),
}))

import { signPreparedSponsoredPackage } from './rawTransactionSigning.js'

const transactions = [
    'fee-payment-transfer',
    'token-approval',
    'normal-swap',
].map((action, index) => ({
    intentId: `intent-${index}`,
    action,
    transaction: {
        from: '0x1111111111111111111111111111111111111111',
        to: '0x2222222222222222222222222222222222222222',
        data: '0x1234',
        value: '0x0',
        chainId: '0x38',
        nonce: `0x${index.toString(16)}`,
        gas: '0x5208',
        gasPrice: '0x0',
        type: '0x0',
    },
}))
const capability = {
    rawTransactionSigningSupported: true,
    method: 'eth_signTransaction',
    transport: 'pistachio-local',
}

beforeEach(() => vi.restoreAllMocks())

describe('pre-signed Gas Assist package', () => {
    it('submits only after all three transactions are signed', async () => {
        const request = vi.fn()
            .mockResolvedValueOnce('0xaaaa')
            .mockResolvedValueOnce('0xbbbb')
            .mockResolvedValueOnce('0xcccc')
        const submitSignedPackage = vi.fn(async (values) => values)
        const result = await signPreparedSponsoredPackage({
            transport: 'pistachio-local', capability,
            walletClient: { request }, preparedPackage: { transactions },
            authenticatedWalletAddress: transactions[0].transaction.from,
            submitSignedPackage,
        })
        expect(request).toHaveBeenCalledTimes(3)
        expect(submitSignedPackage).toHaveBeenCalledTimes(1)
        expect(result.map((value) => value.action)).toEqual([
            'fee-payment-transfer','token-approval','normal-swap',
        ])
    })

    it('never submits a partial package', async () => {
        const request = vi.fn()
            .mockResolvedValueOnce('0xaaaa')
            .mockRejectedValueOnce(new Error('rejected'))
        const submitSignedPackage = vi.fn()
        await expect(signPreparedSponsoredPackage({
            transport: 'pistachio-local', capability,
            walletClient: { request }, preparedPackage: { transactions },
            authenticatedWalletAddress: transactions[0].transaction.from,
            submitSignedPackage,
        })).rejects.toThrow('rejected')
        expect(submitSignedPackage).not.toHaveBeenCalled()
    })
})
""",
)

# Final normal CI workflow, including package tests but never the live-money canary.
final_ci = """name: MegaFuel exact flow

on:
  pull_request:
    paths:
      - '.github/workflows/ci.yml'
      - 'apps/api/.env.megafuel.example'
      - 'apps/api/drizzle/**'
      - 'apps/api/src/**'
      - 'apps/api/test/**'
      - 'docs/megafuel-exact-payment-rollout.md'
      - 'src/features/gas-assist/**'
      - 'src/features/passkey/services/signingReview*'
      - 'src/features/swap/**'
      - 'src/services/swapExecutionMode*'
  push:
    branches: [main]
    paths:
      - '.github/workflows/ci.yml'
      - 'apps/api/.env.megafuel.example'
      - 'apps/api/drizzle/**'
      - 'apps/api/src/**'
      - 'apps/api/test/**'
      - 'docs/megafuel-exact-payment-rollout.md'
      - 'src/features/gas-assist/**'
      - 'src/features/passkey/services/signingReview*'
      - 'src/features/swap/**'
      - 'src/services/swapExecutionMode*'

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.30.3
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Lint
        run: pnpm lint
      - name: Frontend Gas Assist tests
        run: >-
          pnpm exec vitest run
          src/features/gas-assist/services/rawTransactionSigning.test.js
          src/features/gas-assist/services/rawTransactionSigning.package.test.js
          src/features/gas-assist/hooks/usePrepaidSponsorship.test.jsx
          src/features/gas-assist/hooks/useGasAssistController.test.jsx
          src/features/gas-assist/components/GasAssistPrepaymentDialog.test.jsx
          src/features/passkey/services/signingReview.test.js
          src/features/swap/hooks/useSwapQuote.gas-assist.test.jsx
          src/services/swapExecutionMode.test.js
          --reporter=verbose
      - name: API typecheck
        run: pnpm --filter @pistachio/api typecheck
      - name: API Gas Assist tests
        run: >-
          pnpm --filter @pistachio/api exec vitest run
          test/gasless-v2.test.ts
          test/prepaid-sponsorship.test.ts
          test/megafuel-durable-intents.test.ts
          test/megafuel-exact-payment.test.ts
          test/megafuel-normal-swap.test.ts
          test/megafuel-presigned-package.test.ts
          test/megafuel-two-policy.test.ts
          test/moralis-sponsorship-evidence.test.ts
          test/payment-token-selection-native.test.ts
          test/paymaster-sponsorability-fallback.test.ts
          test/provider-response-debug.test.ts
          test/token-evidence-exact-transfer.test.ts
          test/token-price-normalization.test.ts
          --reporter=verbose
      - name: Frontend build
        run: pnpm build
"""
write(".github/workflows/ci.yml", final_ci)
Path(".github/workflows/agent-presigned-package.yml").unlink(missing_ok=True)
Path(".github/apply-presigned-package.py").unlink()
