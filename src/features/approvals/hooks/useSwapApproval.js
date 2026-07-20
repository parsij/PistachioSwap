import { useCallback, useRef } from 'react'
import { encodeFunctionData, isAddress } from 'viem'
import { usePublicClient, useWalletClient } from 'wagmi'

const approveAbi = [{
    type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
}]

const readAbi = [{
    type: 'function', name: 'allowance', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ type: 'uint256' }],
}]

const permit2Abi = [
    {
        type: 'function', name: 'allowance', stateMutability: 'view',
        inputs: [
            { name: 'owner', type: 'address' },
            { name: 'token', type: 'address' },
            { name: 'spender', type: 'address' },
        ],
        outputs: [
            { name: 'amount', type: 'uint160' },
            { name: 'expiration', type: 'uint48' },
            { name: 'nonce', type: 'uint48' },
        ],
    },
    {
        type: 'function', name: 'approve', stateMutability: 'nonpayable',
        inputs: [
            { name: 'token', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'amount', type: 'uint160' },
            { name: 'expiration', type: 'uint48' },
        ],
        outputs: [],
    },
]

const UINT160_MAX = (1n << 160n) - 1n
const PERMIT2_APPROVAL_TTL_SECONDS = 30n * 60n
const PERMIT2_EXPIRATION_SAFETY_SECONDS = 60n

// Temporary exhaustive tracing. Set this to false after the bug is found.
const SWAP_APPROVAL_TRACE_ENABLED = true

let approvalTraceAttemptCounter = 0

function isPositiveInteger(value) {
    return /^[1-9]\d*$/.test(String(value ?? ''))
}

function sameAddress(left, right) {
    return String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase()
}

function parsePermit2Allowance(value) {
    if (Array.isArray(value)) {
        return {
            amount: BigInt(value[0] ?? 0),
            expiration: BigInt(value[1] ?? 0),
            nonce: BigInt(value[2] ?? 0),
        }
    }

    return {
        amount: BigInt(value?.amount ?? 0),
        expiration: BigInt(value?.expiration ?? 0),
        nonce: BigInt(value?.nonce ?? 0),
    }
}

function permit2Expiration() {
    return BigInt(Math.floor(Date.now() / 1000)) + PERMIT2_APPROVAL_TTL_SECONDS
}

function sanitizeTraceValue(value, depth = 0) {
    if (depth > 5) return '[max-depth]'

    if (typeof value === 'bigint') {
        return value.toString()
    }

    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack ?? null,
        }
    }

    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeTraceValue(entry, depth + 1))
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [
                key,
                sanitizeTraceValue(entry, depth + 1),
            ]),
        )
    }

    return value
}

function createApprovalTrace() {
    const attemptId = ++approvalTraceAttemptCounter

    let step = 0
    let lastEvent = 'trace.created'

    const emit = (event, details = {}, level = 'info') => {
        lastEvent = event
        step += 1

        if (!SWAP_APPROVAL_TRACE_ENABLED) return

        const prefix =
            `[swap-approval-trace][attempt-${attemptId}]` +
            `[step-${String(step).padStart(3, '0')}]`

        const payload = sanitizeTraceValue({
            timestamp: new Date().toISOString(),
            event,
            ...details,
        })

        const logger = level === 'error'
            ? console.error
            : level === 'warn'
                ? console.warn
                : console.info

        logger(prefix, payload)
    }

    return {
        attemptId,
        emit,
        getLastEvent: () => lastEvent,
        getStep: () => step,
    }
}

function logApprovalState(event, details = {}, level = 'info') {
    if (!SWAP_APPROVAL_TRACE_ENABLED) return

    const prefix = '[swap-approval-trace][state]'

    const payload = sanitizeTraceValue({
        timestamp: new Date().toISOString(),
        event,
        ...details,
    })

    const logger = level === 'error'
        ? console.error
        : level === 'warn'
            ? console.warn
            : console.info

    logger(prefix, payload)
}

/**
 * Prepares normal user-paid ERC-20 and Permit2 authorization for a same-chain
 * swap quote. Gas Assist does not use this hook.
 *
 * @param {object} options
 * @param {object|null} options.quote
 * @param {string|null} options.walletAddress
 * @param {object|null} options.sellToken
 * @param {string|null} options.amountIn
 * @param {number|string} options.chainId
 * @param {Function} [options.onApprovalConfirmed]
 * @param {Function} [options.onDiagnostic]
 *
 * @returns {{
 *   prepareSwapApproval: Function,
 *   getLastPreparationResult: Function,
 *   invalidatePermit2Readiness: Function
 * }}
 */
export function useSwapApproval({
                                    quote,
                                    walletAddress,
                                    sellToken,
                                    amountIn,
                                    chainId,
                                    onApprovalConfirmed,
                                    onDiagnostic,
                                }) {
    const publicClient = usePublicClient({ chainId })
    const { data: walletClient } = useWalletClient({ chainId })

    const pendingRef = useRef(null)
    const pendingAttemptIdRef = useRef(null)

    const lastPreparationRef = useRef({
        approvalReady: false,
        approvalTransactionSubmitted: false,
    })

    const prepareSwapApproval = useCallback(async (quoteOverride = null) => {
        const trace = createApprovalTrace()

        trace.emit('prepareSwapApproval.entered', {
            hasQuoteOverride: Boolean(quoteOverride),
            hasCurrentQuote: Boolean(quote),
            walletAddress: walletAddress ?? null,
            sellTokenAddress: sellToken?.address ?? null,
            sellTokenIsNative: sellToken?.isNative === true,
            amountIn: amountIn ?? null,
            requestedChainId: chainId ?? null,
            hasPublicClient: Boolean(publicClient),
            hasWalletClient: Boolean(walletClient),
            walletClientChainId: walletClient?.chain?.id ?? null,
        })

        if (pendingRef.current) {
            trace.emit('prepareSwapApproval.pending-promise-reused', {
                activeAttemptId: pendingAttemptIdRef.current,
                result: 'return-existing-promise',
            }, 'warn')

            return pendingRef.current
        }

        trace.emit('prepareSwapApproval.new-task-created', {
            attemptId: trace.attemptId,
        })

        const task = (async () => {
            let approvalTransactionSubmitted = false
            let taskSucceeded = false

            try {
                trace.emit('preparation-state.reset.start', {
                    previous: lastPreparationRef.current,
                })

                lastPreparationRef.current = {
                    approvalReady: false,
                    approvalTransactionSubmitted: false,
                }

                trace.emit('preparation-state.reset.complete', {
                    current: lastPreparationRef.current,
                })

                const finish = (approvalReady, reason = 'unspecified') => {
                    trace.emit('finish.called', {
                        approvalReady,
                        approvalTransactionSubmitted,
                        reason,
                    }, approvalReady ? 'info' : 'warn')

                    lastPreparationRef.current = {
                        approvalReady,
                        approvalTransactionSubmitted,
                    }

                    trace.emit('finish.state-written', {
                        result: lastPreparationRef.current,
                    })

                    return approvalReady
                }

                trace.emit('quote-selection.start', {
                    source: quoteOverride ? 'quoteOverride' : 'currentQuote',
                })

                const selectedQuoteResponse = quoteOverride ?? quote
                const selected = selectedQuoteResponse?.selectedQuote

                trace.emit('quote-selection.complete', {
                    hasQuoteResponse: Boolean(selectedQuoteResponse),
                    hasSelectedQuote: Boolean(selected),
                    approvalSchemaVersion:
                        selectedQuoteResponse?.approvalSchemaVersion ?? null,
                    provider: selected?.provider ?? null,
                    chainId: selected?.chainId ?? null,
                    mode: selected?.mode ?? null,
                    sellToken: selected?.sellToken ?? null,
                    buyToken: selected?.buyToken ?? null,
                    maximumSellAmount: selected?.maximumSellAmount ?? null,
                    allowanceTarget: selected?.allowanceTarget ?? null,
                    transactionTarget: selected?.transaction?.to ?? null,
                    transactionHasData: Boolean(selected?.transaction?.data),
                    transactionValue: selected?.transaction?.value ?? null,
                    approval: {
                        mode: selected?.approval?.mode ?? null,
                        contract: selected?.approval?.contract ?? null,
                        spender: selected?.approval?.spender ?? null,
                        token: selected?.approval?.token ?? null,
                        requiredAmount:
                            selected?.approval?.requiredAmount ?? null,
                    },
                })

                trace.emit('diagnostic.approval.prepare.start.before')

                onDiagnostic?.('approval.prepare.start', {
                    provider: selected?.provider ?? null,
                    chainId,
                    token: sellToken?.address ?? null,
                    isNative: sellToken?.isNative === true,
                })

                trace.emit('diagnostic.approval.prepare.start.after')

                trace.emit(
                    'diagnostic.approval.metadata.prepare-input.before',
                )

                onDiagnostic?.('approval.metadata.prepare-input', {
                    hasApproval: Boolean(selected?.approval),
                    mode: selected?.approval?.mode ?? null,
                    contract: selected?.approval?.contract ?? null,
                    spender: selected?.approval?.spender ?? null,
                    token: selected?.approval?.token ?? null,
                    requiredAmount:
                        selected?.approval?.requiredAmount ?? null,
                    provider: selected?.provider ?? null,
                    transactionTarget: selected?.transaction?.to ?? null,
                    chainId: selected?.chainId ?? null,
                })

                trace.emit(
                    'diagnostic.approval.metadata.prepare-input.after',
                )

                trace.emit('native-token.check', {
                    isNative: sellToken?.isNative === true,
                })

                if (sellToken?.isNative) {
                    trace.emit('native-token.skip-approval', {
                        chainId,
                    })

                    onDiagnostic?.('approval.prepare.native-skip', {
                        chainId,
                    })

                    taskSucceeded = true

                    return finish(
                        true,
                        'native-token-does-not-require-approval',
                    )
                }

                const dependencyChecks = {
                    hasSelectedQuote: Boolean(selected),
                    hasWalletAddress: Boolean(walletAddress),
                    hasPublicClient: Boolean(publicClient),
                    hasWalletClient: Boolean(walletClient),
                    walletClientChainId:
                        walletClient?.chain?.id ?? null,
                }

                trace.emit(
                    'required-dependencies.checked',
                    dependencyChecks,
                    Object.values(dependencyChecks).includes(false)
                        ? 'warn'
                        : 'info',
                )

                if (
                    !selected ||
                    !walletAddress ||
                    !publicClient ||
                    !walletClient
                ) {
                    trace.emit(
                        'prepare.blocked.missing-wallet-or-client',
                        dependencyChecks,
                        'error',
                    )

                    onDiagnostic?.('approval.prepare.blocked', {
                        reason: 'missing-wallet-or-client',
                        hasQuote: Boolean(selected),
                        hasWalletAddress: Boolean(walletAddress),
                        hasPublicClient: Boolean(publicClient),
                        hasWalletClient: Boolean(walletClient),
                    }, 'error')

                    throw new Error(
                        'Token approval could not be safely prepared.',
                    )
                }

                trace.emit('erc20-base-values.derivation.start')

                const sellTokenAddress =
                    String(sellToken?.address ?? '')

                const allowanceTarget =
                    String(selected.allowanceTarget ?? '')

                const requiredAmountSource =
                    selected.mode === 'EXACT_OUTPUT'
                        ? 'selected.maximumSellAmount'
                        : 'amountIn'

                const requiredAmount =
                    selected.mode === 'EXACT_OUTPUT'
                        ? selected.maximumSellAmount
                        : amountIn

                trace.emit('erc20-base-values.derivation.complete', {
                    sellTokenAddress,
                    allowanceTarget,
                    requiredAmountSource,
                    requiredAmount,
                    selectedMode: selected.mode ?? null,
                    selectedChainId: selected.chainId ?? null,
                    expectedChainId: chainId,
                    walletClientChainId:
                        walletClient.chain?.id ?? null,
                    selectedSellToken:
                        selected.sellToken ?? null,
                })

                const baseValidation = {
                    sellTokenAddressIsValid:
                        isAddress(sellTokenAddress),

                    quoteChainMatchesRequestedChain:
                        Number(selected.chainId) === Number(chainId),

                    walletChainMatchesRequestedChain:
                        Number(walletClient.chain?.id) ===
                        Number(chainId),

                    quoteSellTokenMatchesSelectedToken:
                        String(selected.sellToken ?? '').toLowerCase() ===
                        sellTokenAddress.toLowerCase(),

                    allowanceTargetIsValidAddress:
                        isAddress(allowanceTarget),

                    allowanceTargetIsNotZero:
                        !/^0x0{40}$/i.test(allowanceTarget),

                    requiredAmountIsPositiveInteger:
                        isPositiveInteger(requiredAmount),
                }

                const baseValidationPassed =
                    Object.values(baseValidation).every(Boolean)

                trace.emit('erc20-base-validation.evaluated', {
                    checks: baseValidation,
                    passed: baseValidationPassed,
                    values: {
                        sellTokenAddress,
                        selectedChainId: selected.chainId,
                        expectedChainId: chainId,
                        walletClientChainId:
                        walletClient.chain?.id,
                        selectedSellToken: selected.sellToken,
                        allowanceTarget,
                        requiredAmount,
                    },
                }, baseValidationPassed ? 'info' : 'error')

                if (!baseValidationPassed) {
                    onDiagnostic?.('approval.prepare.blocked', {
                        reason: 'invalid-erc20-approval-details',
                        selectedChainId: selected.chainId,
                        expectedChainId: chainId,
                        walletClientChainId:
                        walletClient.chain?.id,
                        sellToken: selected.sellToken,
                        expectedSellToken: sellTokenAddress,
                        allowanceTarget,
                        requiredAmount,
                    }, 'error')

                    throw new Error(
                        'The quote contains invalid token approval details.',
                    )
                }

                trace.emit(
                    'required-amount.bigint-conversion.start',
                    { requiredAmount },
                )

                const required = BigInt(requiredAmount)

                trace.emit(
                    'required-amount.bigint-conversion.complete',
                    {
                        required: required.toString(),
                        exceedsPermit2Uint160:
                            required > UINT160_MAX,
                    },
                )

                const approval = selected.approval

                const providerName =
                    String(selected.provider ?? '')
                        .trim()
                        .toLowerCase()

                const approvalMode =
                    String(approval?.mode ?? '')
                        .trim()
                        .toLowerCase()

                const pancakeProvider =
                    providerName === 'pancakeswap'

                const isPancakeRouterTransaction =
                    approvalMode === 'permit2-allowance' &&
                    sameAddress(
                        approval?.spender,
                        selected.transaction?.to,
                    )

                const permit2Intent =
                    approvalMode === 'permit2-allowance' ||
                    pancakeProvider

                trace.emit(
                    'approval-strategy.inputs-normalized',
                    {
                        providerRaw:
                            selected.provider ?? null,
                        providerName:
                            providerName || null,
                        approvalModeRaw:
                            approval?.mode ?? null,
                        approvalMode:
                            approvalMode || null,
                        pancakeProvider,
                        isPancakeRouterTransaction,
                        permit2Intent,
                    },
                )

                const permit2MetadataChecks = {
                    modeIsPermit2Allowance:
                        approvalMode === 'permit2-allowance',

                    contractIsValidAddress:
                        isAddress(approval?.contract ?? ''),

                    spenderIsValidAddress:
                        isAddress(approval?.spender ?? ''),

                    tokenIsValidAddress:
                        isAddress(approval?.token ?? ''),

                    requiredAmountIsPositiveInteger:
                        isPositiveInteger(
                            approval?.requiredAmount,
                        ),

                    contractMatchesAllowanceTarget:
                        sameAddress(
                            approval?.contract,
                            selected.allowanceTarget,
                        ),

                    spenderMatchesTransactionTarget:
                        sameAddress(
                            approval?.spender,
                            selected.transaction?.to,
                        ),

                    tokenMatchesQuoteSellToken:
                        sameAddress(
                            approval?.token,
                            selected.sellToken,
                        ),

                    quoteSellTokenMatchesCurrentSellToken:
                        sameAddress(
                            selected.sellToken,
                            sellTokenAddress,
                        ),

                    approvalAmountCoversRequiredAmount:
                        isPositiveInteger(
                            approval?.requiredAmount,
                        ) &&
                        BigInt(approval.requiredAmount) >= required,
                }

                const hasCanonicalPermit2Metadata =
                    Object.values(
                        permit2MetadataChecks,
                    ).every(Boolean)

                const erc20MetadataChecks = {
                    modeIsDirectErc20:
                        approvalMode === 'erc20',

                    contractIsValidAddress:
                        isAddress(approval?.contract ?? ''),

                    spenderIsValidAddress:
                        isAddress(approval?.spender ?? ''),

                    tokenIsValidAddress:
                        isAddress(approval?.token ?? ''),

                    requiredAmountIsPositiveInteger:
                        isPositiveInteger(
                            approval?.requiredAmount,
                        ),

                    contractMatchesAllowanceTarget:
                        sameAddress(
                            approval?.contract,
                            allowanceTarget,
                        ),

                    spenderMatchesAllowanceTarget:
                        sameAddress(
                            approval?.spender,
                            allowanceTarget,
                        ),

                    tokenMatchesCurrentSellToken:
                        sameAddress(
                            approval?.token,
                            sellTokenAddress,
                        ),
                }

                const hasCanonicalErc20Metadata =
                    Object.values(
                        erc20MetadataChecks,
                    ).every(Boolean)

                trace.emit(
                    'approval-strategy.metadata-validation',
                    {
                        permit2MetadataChecks,
                        hasCanonicalPermit2Metadata,
                        erc20MetadataChecks,
                        hasCanonicalErc20Metadata,

                        metadataValues: {
                            approvalMode,
                            contract:
                                approval?.contract ?? null,
                            spender:
                                approval?.spender ?? null,
                            token:
                                approval?.token ?? null,
                            requiredAmount:
                                approval?.requiredAmount ?? null,
                            selectedAllowanceTarget:
                                selected.allowanceTarget ?? null,
                            selectedTransactionTarget:
                                selected.transaction?.to ?? null,
                            selectedSellToken:
                                selected.sellToken ?? null,
                            currentSellToken:
                            sellTokenAddress,
                            actualRequiredAmount:
                                required.toString(),
                        },
                    },
                    permit2Intent &&
                    !hasCanonicalPermit2Metadata
                        ? 'error'
                        : 'info',
                )

                const strategyRejectionReason =
                    permit2Intent &&
                    !hasCanonicalPermit2Metadata
                        ? 'incomplete-canonical-permit2-metadata'
                        : !permit2Intent &&
                        !hasCanonicalErc20Metadata
                            ? 'missing-explicit-erc20-mode'
                            : null

                const selectedStrategy =
                    strategyRejectionReason
                        ? 'reject'
                        : permit2Intent
                            ? 'permit2-allowance'
                            : 'erc20'

                trace.emit('approval-strategy.selected', {
                    selectedStrategy,
                    strategyRejectionReason,
                    permit2Intent,
                    hasCanonicalPermit2Metadata,
                    hasCanonicalErc20Metadata,
                }, strategyRejectionReason ? 'error' : 'info')

                onDiagnostic?.('approval.strategy.selected', {
                    normalizedProvider:
                        providerName || null,

                    approvalMode:
                        approvalMode || null,

                    hasCanonicalPermit2Metadata,
                    isPancakeRouterTransaction,
                    selectedStrategy,

                    reason:
                        strategyRejectionReason ??
                        (
                            permit2Intent
                                ? 'canonical-permit2-metadata'
                                : 'explicit-direct-erc20-metadata'
                        ),
                }, strategyRejectionReason ? 'error' : 'debug')

                if (strategyRejectionReason) {
                    throw new Error(
                        permit2Intent
                            ? 'The PancakeSwap quote contains invalid Permit2 approval details.'
                            : 'The quote does not declare a safe ERC-20 approval strategy.',
                    )
                }

                if (permit2Intent) {
                    trace.emit('permit2-branch.entered')

                    const permit2Address =
                        String(approval?.contract ?? '')

                    const permit2Spender =
                        String(approval?.spender ?? '')

                    const approvalToken =
                        String(approval?.token ?? '')

                    const approvalAmount =
                        String(approval?.requiredAmount ?? '')

                    const permit2BranchChecks = {
                        approvalModeMatches:
                            approvalMode ===
                            'permit2-allowance',

                        permit2AddressIsValid:
                            isAddress(permit2Address),

                        permit2SpenderIsValid:
                            isAddress(permit2Spender),

                        approvalTokenMatchesCurrentSellToken:
                            sameAddress(
                                approvalToken,
                                sellTokenAddress,
                            ),

                        quoteSellTokenMatchesCurrentSellToken:
                            sameAddress(
                                selected.sellToken,
                                sellTokenAddress,
                            ),

                        allowanceTargetMatchesPermit2:
                            sameAddress(
                                selected.allowanceTarget,
                                permit2Address,
                            ),

                        transactionTargetMatchesPermit2Spender:
                            sameAddress(
                                selected.transaction?.to,
                                permit2Spender,
                            ),

                        approvalAmountIsPositiveInteger:
                            isPositiveInteger(
                                approvalAmount,
                            ),

                        approvalAmountCoversRequired:
                            isPositiveInteger(
                                approvalAmount,
                            ) &&
                            BigInt(approvalAmount) >= required,
                    }

                    const permit2BranchValid =
                        Object.values(
                            permit2BranchChecks,
                        ).every(Boolean)

                    trace.emit(
                        'permit2-branch.metadata-revalidated',
                        {
                            checks: permit2BranchChecks,
                            passed: permit2BranchValid,

                            values: {
                                permit2Address,
                                permit2Spender,
                                approvalToken,
                                approvalAmount,
                                required:
                                    required.toString(),
                                transactionTarget:
                                    selected.transaction?.to ??
                                    null,
                                allowanceTarget:
                                    selected.allowanceTarget ??
                                    null,
                            },
                        },
                        permit2BranchValid
                            ? 'info'
                            : 'error',
                    )

                    if (!permit2BranchValid) {
                        onDiagnostic?.(
                            'approval.permit2.blocked',
                            {
                                reason:
                                    'invalid-permit2-metadata',
                                permit2Address,
                                permit2Spender,
                                approvalToken,
                                approvalAmount,
                                transactionTo:
                                    selected.transaction?.to ??
                                    null,
                                allowanceTarget:
                                    selected.allowanceTarget ??
                                    null,
                            },
                            'error',
                        )

                        throw new Error(
                            'The PancakeSwap quote contains invalid Permit2 approval details.',
                        )
                    }

                    trace.emit(
                        'permit2.erc20-allowance.read.preparing',
                        {
                            token: sellTokenAddress,
                            owner: walletAddress,
                            spender: permit2Address,
                            requiredAmount:
                                required.toString(),
                        },
                    )

                    onDiagnostic?.(
                        'approval.erc20.read.start',
                        {
                            token: sellTokenAddress,
                            owner: walletAddress,
                            spender: permit2Address,
                            requiredAmount:
                                required.toString(),
                        },
                    )

                    trace.emit(
                        'permit2.erc20-allowance.read.awaiting',
                    )

                    let erc20Allowance

                    try {
                        erc20Allowance =
                            await publicClient.readContract({
                                address: sellTokenAddress,
                                abi: readAbi,
                                functionName: 'allowance',
                                args: [
                                    walletAddress,
                                    permit2Address,
                                ],
                            })
                    } catch (error) {
                        trace.emit(
                            'permit2.erc20-allowance.read.rejected',
                            { error },
                            'error',
                        )

                        throw error
                    }

                    trace.emit(
                        'permit2.erc20-allowance.read.resolved',
                        {
                            allowance:
                                erc20Allowance.toString(),
                            required:
                                required.toString(),
                            sufficient:
                                erc20Allowance >= required,
                        },
                    )

                    onDiagnostic?.(
                        'approval.erc20.read.result',
                        {
                            allowance:
                                erc20Allowance.toString(),
                            sufficient:
                                erc20Allowance >= required,
                        },
                    )

                    if (erc20Allowance < required) {
                        trace.emit(
                            'permit2.erc20-approval.required',
                            {
                                allowance:
                                    erc20Allowance.toString(),
                                required:
                                    required.toString(),
                                missingAmount:
                                    (
                                        required -
                                        erc20Allowance
                                    ).toString(),
                            },
                            'warn',
                        )

                        onDiagnostic?.(
                            'approval.erc20.send.start',
                            {
                                token: sellTokenAddress,
                                spender: permit2Address,
                                amount:
                                    required.toString(),
                            },
                        )

                        onDiagnostic?.(
                            'approval.erc20.wallet-prompt.requested',
                            {
                                token: sellTokenAddress,
                                spender: permit2Address,
                            },
                        )

                        trace.emit(
                            'permit2.erc20-approval.calldata-encoding.start',
                            {
                                functionName: 'approve',
                                spender: permit2Address,
                                amount:
                                    required.toString(),
                            },
                        )

                        const data = encodeFunctionData({
                            abi: approveAbi,
                            functionName: 'approve',
                            args: [
                                permit2Address,
                                required,
                            ],
                        })

                        trace.emit(
                            'permit2.erc20-approval.calldata-encoding.complete',
                            {
                                encodedByteLength:
                                    Math.max(
                                        0,
                                        (data.length - 2) / 2,
                                    ),
                                calldataPrinted: false,
                            },
                        )

                        trace.emit(
                            'permit2.erc20-approval.wallet-send.awaiting',
                            {
                                account: walletAddress,
                                chainId:
                                    walletClient.chain?.id ??
                                    null,
                                to: sellTokenAddress,
                                value: '0',
                            },
                        )

                        let hash

                        try {
                            hash =
                                await walletClient.sendTransaction({
                                    account:
                                    walletAddress,
                                    chain:
                                    walletClient.chain,
                                    to:
                                    sellTokenAddress,
                                    data,
                                    value: 0n,
                                })
                        } catch (error) {
                            trace.emit(
                                'permit2.erc20-approval.wallet-send.rejected',
                                { error },
                                'error',
                            )

                            throw error
                        }

                        trace.emit(
                            'permit2.erc20-approval.wallet-send.resolved',
                            { hash },
                        )

                        onDiagnostic?.(
                            'approval.erc20.transaction.submitted',
                            { hash },
                        )

                        trace.emit(
                            'permit2.erc20-approval.receipt.awaiting',
                            { hash },
                        )

                        let receipt

                        try {
                            receipt =
                                await publicClient
                                    .waitForTransactionReceipt({
                                        hash,
                                    })
                        } catch (error) {
                            trace.emit(
                                'permit2.erc20-approval.receipt.rejected',
                                {
                                    hash,
                                    error,
                                },
                                'error',
                            )

                            throw error
                        }

                        trace.emit(
                            'permit2.erc20-approval.receipt.resolved',
                            {
                                hash,
                                status: receipt.status,
                            },
                            receipt.status === 'success'
                                ? 'info'
                                : 'error',
                        )

                        onDiagnostic?.(
                            'approval.erc20.receipt',
                            {
                                hash,
                                status: receipt.status,
                            },
                            receipt.status === 'success'
                                ? 'debug'
                                : 'error',
                        )

                        if (receipt.status !== 'success') {
                            throw new Error(
                                'The approval transaction failed.',
                            )
                        }

                        approvalTransactionSubmitted = true

                        trace.emit(
                            'permit2.erc20-approval.submission-flag-set',
                            {
                                approvalTransactionSubmitted,
                            },
                        )

                        onDiagnostic?.(
                            'approval.erc20.receipt.confirmed',
                            { hash },
                        )

                        trace.emit(
                            'permit2.erc20-allowance.reread.awaiting',
                            {
                                token: sellTokenAddress,
                                owner: walletAddress,
                                spender: permit2Address,
                            },
                        )

                        try {
                            erc20Allowance =
                                await publicClient
                                    .readContract({
                                        address:
                                        sellTokenAddress,
                                        abi: readAbi,
                                        functionName:
                                            'allowance',
                                        args: [
                                            walletAddress,
                                            permit2Address,
                                        ],
                                    })
                        } catch (error) {
                            trace.emit(
                                'permit2.erc20-allowance.reread.rejected',
                                { error },
                                'error',
                            )

                            throw error
                        }

                        trace.emit(
                            'permit2.erc20-allowance.reread.resolved',
                            {
                                allowance:
                                    erc20Allowance.toString(),
                                required:
                                    required.toString(),
                                sufficient:
                                    erc20Allowance >= required,
                            },
                        )

                        onDiagnostic?.(
                            'approval.erc20.reread.result',
                            {
                                allowance:
                                    erc20Allowance.toString(),
                                sufficient:
                                    erc20Allowance >= required,
                            },
                        )

                        if (erc20Allowance < required) {
                            trace.emit(
                                'permit2.erc20-allowance.reread-still-insufficient',
                                {
                                    allowance:
                                        erc20Allowance.toString(),
                                    required:
                                        required.toString(),
                                },
                                'error',
                            )

                            return finish(
                                false,
                                'erc20-allowance-still-insufficient-after-approval',
                            )
                        }
                    } else {
                        trace.emit(
                            'permit2.erc20-approval.not-required',
                            {
                                allowance:
                                    erc20Allowance.toString(),
                                required:
                                    required.toString(),
                            },
                        )
                    }

                    const readPermit2Allowance =
                        async (phase) => {
                            trace.emit(
                                `permit2.allowance.${phase}.preparing`,
                                {
                                    permit2Address,
                                    owner: walletAddress,
                                    token: sellTokenAddress,
                                    spender: permit2Spender,
                                    requiredAmount:
                                        required.toString(),
                                },
                            )

                            trace.emit(
                                `permit2.allowance.${phase}.awaiting`,
                            )

                            let rawAllowance

                            try {
                                rawAllowance =
                                    await publicClient
                                        .readContract({
                                            address:
                                            permit2Address,
                                            abi: permit2Abi,
                                            functionName:
                                                'allowance',
                                            args: [
                                                walletAddress,
                                                sellTokenAddress,
                                                permit2Spender,
                                            ],
                                        })
                            } catch (error) {
                                trace.emit(
                                    `permit2.allowance.${phase}.rejected`,
                                    { error },
                                    'error',
                                )

                                throw error
                            }

                            trace.emit(
                                `permit2.allowance.${phase}.resolved`,
                                {
                                    responseShape:
                                        Array.isArray(
                                            rawAllowance,
                                        )
                                            ? 'array'
                                            : typeof rawAllowance,

                                    arrayLength:
                                        Array.isArray(
                                            rawAllowance,
                                        )
                                            ? rawAllowance.length
                                            : null,

                                    hasAmountField:
                                        Boolean(
                                            rawAllowance &&
                                            !Array.isArray(
                                                rawAllowance,
                                            ) &&
                                            'amount' in
                                            rawAllowance,
                                        ),

                                    hasExpirationField:
                                        Boolean(
                                            rawAllowance &&
                                            !Array.isArray(
                                                rawAllowance,
                                            ) &&
                                            'expiration' in
                                            rawAllowance,
                                        ),

                                    hasNonceField:
                                        Boolean(
                                            rawAllowance &&
                                            !Array.isArray(
                                                rawAllowance,
                                            ) &&
                                            'nonce' in
                                            rawAllowance,
                                        ),
                                },
                            )

                            const parsed =
                                parsePermit2Allowance(
                                    rawAllowance,
                                )

                            trace.emit(
                                `permit2.allowance.${phase}.parsed`,
                                {
                                    amount:
                                        parsed.amount.toString(),
                                    expiration:
                                        parsed.expiration.toString(),
                                    nonce:
                                        parsed.nonce.toString(),
                                },
                            )

                            return parsed
                        }

                    onDiagnostic?.(
                        'approval.permit2.read.start',
                        {
                            permit2Address,
                            owner: walletAddress,
                            token: sellTokenAddress,
                            spender: permit2Spender,
                            requiredAmount:
                                required.toString(),
                        },
                    )

                    trace.emit(
                        'permit2.allowance.initial-read.diagnostic-emitted',
                    )

                    let permit2Allowance =
                        await readPermit2Allowance(
                            'initial-read',
                        )

                    const now =
                        BigInt(
                            Math.floor(Date.now() / 1000),
                        )

                    const minimumExpiration =
                        now +
                        PERMIT2_EXPIRATION_SAFETY_SECONDS

                    const amountSufficient =
                        permit2Allowance.amount >= required

                    const expirationValid =
                        permit2Allowance.expiration >
                        minimumExpiration

                    const renewalRequired =
                        !amountSufficient ||
                        !expirationValid

                    const renewalReason =
                        !amountSufficient
                            ? 'insufficient-amount'
                            : !expirationValid
                                ? 'expiration-too-close'
                                : null

                    trace.emit(
                        'permit2.allowance.initial-evaluation',
                        {
                            amount:
                                permit2Allowance.amount.toString(),
                            expiration:
                                permit2Allowance.expiration.toString(),
                            nonce:
                                permit2Allowance.nonce.toString(),
                            required:
                                required.toString(),
                            now:
                                now.toString(),
                            safetySeconds:
                                PERMIT2_EXPIRATION_SAFETY_SECONDS
                                    .toString(),
                            minimumExpiration:
                                minimumExpiration.toString(),
                            amountSufficient,
                            expirationValid,
                            renewalRequired,
                            renewalReason,
                        },
                        renewalRequired
                            ? 'warn'
                            : 'info',
                    )

                    onDiagnostic?.(
                        'approval.permit2.read.result',
                        {
                            amount:
                                permit2Allowance.amount.toString(),
                            expiration:
                                permit2Allowance.expiration.toString(),
                            now:
                                now.toString(),
                            sufficientAmount:
                            amountSufficient,
                            minimumExpiration:
                                minimumExpiration.toString(),
                            unexpired:
                            expirationValid,
                        },
                    )

                    if (renewalRequired) {
                        trace.emit(
                            'permit2.renewal.branch-entered',
                            {
                                renewalReason,
                                required:
                                    required.toString(),
                                uint160Max:
                                    UINT160_MAX.toString(),
                                requiredFitsUint160:
                                    required <= UINT160_MAX,
                            },
                            'warn',
                        )

                        if (required > UINT160_MAX) {
                            throw new Error(
                                'The PancakeSwap approval amount exceeds Permit2 limits.',
                            )
                        }

                        onDiagnostic?.(
                            'approval.permit2.renewal.required',
                            {
                                reason:
                                renewalReason,
                            },
                        )

                        onDiagnostic?.(
                            'approval.permit2.send.start',
                            {
                                permit2Address,
                                token:
                                sellTokenAddress,
                                spender:
                                permit2Spender,
                                amount:
                                    required.toString(),
                            },
                        )

                        onDiagnostic?.(
                            'approval.permit2.wallet-prompt.requested',
                            {
                                permit2Address,
                                token:
                                sellTokenAddress,
                                spender:
                                permit2Spender,
                            },
                        )

                        const newExpiration =
                            permit2Expiration()

                        trace.emit(
                            'permit2.approval.calldata-encoding.start',
                            {
                                functionName: 'approve',
                                token:
                                sellTokenAddress,
                                spender:
                                permit2Spender,
                                amount:
                                    required.toString(),
                                expiration:
                                    newExpiration.toString(),
                                ttlSeconds:
                                    PERMIT2_APPROVAL_TTL_SECONDS
                                        .toString(),
                            },
                        )

                        const data =
                            encodeFunctionData({
                                abi: permit2Abi,
                                functionName:
                                    'approve',
                                args: [
                                    sellTokenAddress,
                                    permit2Spender,
                                    required,
                                    newExpiration,
                                ],
                            })

                        trace.emit(
                            'permit2.approval.calldata-encoding.complete',
                            {
                                encodedByteLength:
                                    Math.max(
                                        0,
                                        (data.length - 2) / 2,
                                    ),
                                calldataPrinted: false,
                            },
                        )

                        trace.emit(
                            'permit2.approval.wallet-send.awaiting',
                            {
                                account:
                                walletAddress,
                                chainId:
                                    walletClient.chain?.id ??
                                    null,
                                to:
                                permit2Address,
                                token:
                                sellTokenAddress,
                                spender:
                                permit2Spender,
                                amount:
                                    required.toString(),
                                expiration:
                                    newExpiration.toString(),
                                value: '0',
                            },
                        )

                        let hash

                        try {
                            hash =
                                await walletClient
                                    .sendTransaction({
                                        account:
                                        walletAddress,
                                        chain:
                                        walletClient.chain,
                                        to:
                                        permit2Address,
                                        data,
                                        value: 0n,
                                    })
                        } catch (error) {
                            trace.emit(
                                'permit2.approval.wallet-send.rejected',
                                { error },
                                'error',
                            )

                            throw error
                        }

                        trace.emit(
                            'permit2.approval.wallet-send.resolved',
                            { hash },
                        )

                        onDiagnostic?.(
                            'approval.permit2.transaction.submitted',
                            { hash },
                        )

                        onDiagnostic?.(
                            'approval.permit2.receipt.waiting',
                            { hash },
                        )

                        trace.emit(
                            'permit2.approval.receipt.awaiting',
                            { hash },
                        )

                        let receipt

                        try {
                            receipt =
                                await publicClient
                                    .waitForTransactionReceipt({
                                        hash,
                                    })
                        } catch (error) {
                            trace.emit(
                                'permit2.approval.receipt.rejected',
                                {
                                    hash,
                                    error,
                                },
                                'error',
                            )

                            throw error
                        }

                        trace.emit(
                            'permit2.approval.receipt.resolved',
                            {
                                hash,
                                status: receipt.status,
                            },
                            receipt.status === 'success'
                                ? 'info'
                                : 'error',
                        )

                        onDiagnostic?.(
                            'approval.permit2.receipt',
                            {
                                hash,
                                status:
                                receipt.status,
                            },
                            receipt.status === 'success'
                                ? 'debug'
                                : 'error',
                        )

                        if (receipt.status !== 'success') {
                            throw new Error(
                                'The Permit2 approval transaction failed.',
                            )
                        }

                        approvalTransactionSubmitted = true

                        trace.emit(
                            'permit2.approval.submission-flag-set',
                            {
                                approvalTransactionSubmitted,
                            },
                        )

                        onDiagnostic?.(
                            'approval.permit2.receipt.confirmed',
                            {
                                hash,
                                status:
                                receipt.status,
                            },
                        )

                        onDiagnostic?.(
                            'approval.permit2.reread.start',
                            {
                                permit2Address,
                                owner:
                                walletAddress,
                                token:
                                sellTokenAddress,
                                spender:
                                permit2Spender,
                            },
                        )

                        permit2Allowance =
                            await readPermit2Allowance(
                                'post-approval-reread',
                            )
                    } else {
                        trace.emit(
                            'permit2.renewal.not-required',
                            {
                                amount:
                                    permit2Allowance.amount.toString(),
                                expiration:
                                    permit2Allowance.expiration.toString(),
                            },
                        )
                    }

                    const freshNow =
                        BigInt(
                            Math.floor(Date.now() / 1000),
                        )

                    const freshMinimumExpiration =
                        freshNow +
                        PERMIT2_EXPIRATION_SAFETY_SECONDS

                    const freshAmountSufficient =
                        permit2Allowance.amount >= required

                    const freshExpirationValid =
                        permit2Allowance.expiration >
                        freshMinimumExpiration

                    trace.emit(
                        'permit2.allowance.final-evaluation',
                        {
                            amount:
                                permit2Allowance.amount.toString(),
                            expiration:
                                permit2Allowance.expiration.toString(),
                            nonce:
                                permit2Allowance.nonce.toString(),
                            required:
                                required.toString(),
                            now:
                                freshNow.toString(),
                            minimumExpiration:
                                freshMinimumExpiration.toString(),
                            amountSufficient:
                            freshAmountSufficient,
                            expirationValid:
                            freshExpirationValid,
                            approvalTransactionSubmitted,
                        },
                        freshAmountSufficient &&
                        freshExpirationValid
                            ? 'info'
                            : 'error',
                    )

                    onDiagnostic?.(
                        'approval.permit2.reread.result',
                        {
                            amount:
                                permit2Allowance.amount.toString(),
                            expiration:
                                permit2Allowance.expiration.toString(),
                            now:
                                freshNow.toString(),
                            sufficientAmount:
                            freshAmountSufficient,
                            minimumExpiration:
                                freshMinimumExpiration.toString(),
                            unexpired:
                            freshExpirationValid,
                        },
                    )

                    if (
                        !freshAmountSufficient ||
                        !freshExpirationValid
                    ) {
                        return finish(
                            false,
                            'permit2-allowance-not-ready-after-final-read',
                        )
                    }

                    if (approvalTransactionSubmitted) {
                        trace.emit(
                            'onApprovalConfirmed.callback.awaiting',
                        )

                        try {
                            await onApprovalConfirmed?.()
                        } catch (error) {
                            trace.emit(
                                'onApprovalConfirmed.callback.rejected',
                                { error },
                                'error',
                            )

                            throw error
                        }

                        trace.emit(
                            'onApprovalConfirmed.callback.resolved',
                        )
                    } else {
                        trace.emit(
                            'onApprovalConfirmed.callback.skipped',
                            {
                                reason:
                                    'no-approval-transaction-submitted',
                            },
                        )
                    }

                    taskSucceeded = true

                    return finish(
                        true,
                        'permit2-allowances-ready',
                    )
                }

                trace.emit(
                    'direct-erc20-branch.entered',
                    {
                        token: sellTokenAddress,
                        owner: walletAddress,
                        spender: allowanceTarget,
                        requiredAmount:
                            required.toString(),
                    },
                )

                onDiagnostic?.(
                    'approval.erc20.read.start',
                    {
                        token: sellTokenAddress,
                        owner: walletAddress,
                        spender: allowanceTarget,
                        requiredAmount:
                            required.toString(),
                    },
                )

                trace.emit(
                    'direct-erc20.allowance.read.awaiting',
                )

                let allowance

                try {
                    allowance =
                        await publicClient.readContract({
                            address: sellTokenAddress,
                            abi: readAbi,
                            functionName: 'allowance',
                            args: [
                                walletAddress,
                                allowanceTarget,
                            ],
                        })
                } catch (error) {
                    trace.emit(
                        'direct-erc20.allowance.read.rejected',
                        { error },
                        'error',
                    )

                    throw error
                }

                trace.emit(
                    'direct-erc20.allowance.read.resolved',
                    {
                        allowance:
                            allowance.toString(),
                        requiredAmount:
                            required.toString(),
                        sufficient:
                            allowance >= required,
                    },
                )

                onDiagnostic?.(
                    'approval.erc20.read.result',
                    {
                        token: sellTokenAddress,
                        owner: walletAddress,
                        spender: allowanceTarget,
                        allowance:
                            allowance.toString(),
                        requiredAmount:
                            required.toString(),
                        sufficient:
                            allowance >= required,
                    },
                )

                if (allowance >= required) {
                    trace.emit(
                        'direct-erc20.approval.not-required',
                    )

                    taskSucceeded = true

                    return finish(
                        true,
                        'direct-erc20-allowance-already-sufficient',
                    )
                }

                trace.emit(
                    'direct-erc20.approval.required',
                    {
                        allowance:
                            allowance.toString(),
                        required:
                            required.toString(),
                        missingAmount:
                            (
                                required -
                                allowance
                            ).toString(),
                    },
                    'warn',
                )

                onDiagnostic?.(
                    'approval.erc20.send.start',
                    {
                        token: sellTokenAddress,
                        spender: allowanceTarget,
                        amount:
                            required.toString(),
                    },
                )

                trace.emit(
                    'direct-erc20.approval.calldata-encoding.start',
                    {
                        functionName: 'approve',
                        spender: allowanceTarget,
                        amount:
                            required.toString(),
                    },
                )

                const data = encodeFunctionData({
                    abi: approveAbi,
                    functionName: 'approve',
                    args: [
                        allowanceTarget,
                        required,
                    ],
                })

                trace.emit(
                    'direct-erc20.approval.calldata-encoding.complete',
                    {
                        encodedByteLength:
                            Math.max(
                                0,
                                (data.length - 2) / 2,
                            ),
                        calldataPrinted: false,
                    },
                )

                trace.emit(
                    'direct-erc20.approval.wallet-send.awaiting',
                    {
                        account: walletAddress,
                        chainId:
                            walletClient.chain?.id ??
                            null,
                        to: sellTokenAddress,
                        spender: allowanceTarget,
                        amount:
                            required.toString(),
                        value: '0',
                    },
                )

                let hash

                try {
                    hash =
                        await walletClient.sendTransaction({
                            account: walletAddress,
                            chain: walletClient.chain,
                            to: sellTokenAddress,
                            data,
                            value: 0n,
                        })
                } catch (error) {
                    trace.emit(
                        'direct-erc20.approval.wallet-send.rejected',
                        { error },
                        'error',
                    )

                    throw error
                }

                trace.emit(
                    'direct-erc20.approval.wallet-send.resolved',
                    { hash },
                )

                trace.emit(
                    'direct-erc20.approval.receipt.awaiting',
                    { hash },
                )

                let receipt

                try {
                    receipt =
                        await publicClient
                            .waitForTransactionReceipt({
                                hash,
                            })
                } catch (error) {
                    trace.emit(
                        'direct-erc20.approval.receipt.rejected',
                        {
                            hash,
                            error,
                        },
                        'error',
                    )

                    throw error
                }

                trace.emit(
                    'direct-erc20.approval.receipt.resolved',
                    {
                        hash,
                        status: receipt.status,
                    },
                    receipt.status === 'success'
                        ? 'info'
                        : 'error',
                )

                onDiagnostic?.(
                    'approval.erc20.receipt',
                    {
                        hash,
                        status: receipt.status,
                    },
                    receipt.status === 'success'
                        ? 'debug'
                        : 'error',
                )

                if (receipt.status !== 'success') {
                    throw new Error(
                        'The approval transaction failed.',
                    )
                }

                approvalTransactionSubmitted = true

                trace.emit(
                    'direct-erc20.approval.submission-flag-set',
                    {
                        approvalTransactionSubmitted,
                    },
                )

                trace.emit(
                    'direct-erc20.onApprovalConfirmed.awaiting',
                )

                try {
                    await onApprovalConfirmed?.()
                } catch (error) {
                    trace.emit(
                        'direct-erc20.onApprovalConfirmed.rejected',
                        { error },
                        'error',
                    )

                    throw error
                }

                trace.emit(
                    'direct-erc20.onApprovalConfirmed.resolved',
                )

                taskSucceeded = true

                return finish(
                    false,
                    'direct-erc20-approval-submitted-refresh-required',
                )
            } catch (error) {
                trace.emit(
                    'approval-task.failed',
                    {
                        stoppedAfterEvent:
                            trace.getLastEvent(),
                        stoppedAfterStep:
                            trace.getStep(),
                        approvalTransactionSubmitted,
                        lastPreparationResult:
                        lastPreparationRef.current,
                        error,
                    },
                    'error',
                )

                throw error
            } finally {
                trace.emit(
                    'approval-task.finally',
                    {
                        taskSucceeded,
                        approvalTransactionSubmitted,
                        lastPreparationResult:
                        lastPreparationRef.current,
                    },
                    taskSucceeded
                        ? 'info'
                        : 'warn',
                )
            }
        })()

        pendingRef.current = task
        pendingAttemptIdRef.current = trace.attemptId

        trace.emit('pending-reference.assigned', {
            activeAttemptId:
            pendingAttemptIdRef.current,
        })

        try {
            trace.emit('task-result.awaiting')

            const result = await task

            trace.emit('task-result.resolved', {
                result,
                lastPreparationResult:
                lastPreparationRef.current,
            })

            return result
        } catch (error) {
            trace.emit(
                'task-result.rejected',
                {
                    error,
                    lastPreparationResult:
                    lastPreparationRef.current,
                },
                'error',
            )

            throw error
        } finally {
            const ownsPendingReference =
                pendingRef.current === task

            trace.emit(
                'pending-reference.cleanup.start',
                {
                    ownsPendingReference,
                    activeAttemptId:
                    pendingAttemptIdRef.current,
                },
            )

            if (ownsPendingReference) {
                pendingRef.current = null
                pendingAttemptIdRef.current = null
            }

            trace.emit(
                'pending-reference.cleanup.complete',
                {
                    pendingCleared:
                    ownsPendingReference,
                    activeAttemptId:
                    pendingAttemptIdRef.current,
                },
            )
        }
    }, [
        amountIn,
        chainId,
        onApprovalConfirmed,
        onDiagnostic,
        publicClient,
        quote,
        sellToken,
        walletAddress,
        walletClient,
    ])

    const getLastPreparationResult = useCallback(() => {
        logApprovalState(
            'getLastPreparationResult.called',
            {
                result:
                lastPreparationRef.current,
                hasPendingPreparation:
                    Boolean(pendingRef.current),
                pendingAttemptId:
                pendingAttemptIdRef.current,
            },
        )

        return lastPreparationRef.current
    }, [])

    const invalidatePermit2Readiness =
        useCallback(() => {
            logApprovalState(
                'invalidatePermit2Readiness.start',
                {
                    previous:
                    lastPreparationRef.current,
                    reason:
                        'simulation-allowance-expired',
                },
                'warn',
            )

            lastPreparationRef.current = {
                approvalReady: false,
                approvalTransactionSubmitted: false,
            }

            onDiagnostic?.(
                'approval.permit2.readiness.invalidated',
                {
                    reason:
                        'simulation-allowance-expired',
                },
            )

            logApprovalState(
                'invalidatePermit2Readiness.complete',
                {
                    current:
                    lastPreparationRef.current,
                },
                'warn',
            )
        }, [onDiagnostic])

    logApprovalState('useSwapApproval.render', {
        chainId: chainId ?? null,
        walletAddress: walletAddress ?? null,
        sellTokenAddress:
            sellToken?.address ?? null,
        sellTokenIsNative:
            sellToken?.isNative === true,
        amountIn: amountIn ?? null,
        hasQuote: Boolean(quote),
        hasPublicClient:
            Boolean(publicClient),
        hasWalletClient:
            Boolean(walletClient),
        walletClientChainId:
            walletClient?.chain?.id ?? null,
        hasPendingPreparation:
            Boolean(pendingRef.current),
        lastPreparationResult:
        lastPreparationRef.current,
    })

    return {
        prepareSwapApproval,
        getLastPreparationResult,
        invalidatePermit2Readiness,
    }
}