import type {
    FastifyPluginAsync,
    FastifyReply,
    FastifyRequest,
} from 'fastify'

import { getSafeError } from '../../../lib/errors.js'
import { persistSwapIntent } from '../../../gas-assist/intents.js'
import { createQuoteSelector } from '../services/quote-selector.js'
import { validateQuoteRequest } from '../schemas/quote-utils.js'

const selectQuotes = createQuoteSelector()

async function handleQuote(
    request: FastifyRequest<{ Body: unknown }>,
    reply: FastifyReply,
) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    const abortOnClosedResponse = () => {
        if (!reply.raw.writableEnded) controller.abort()
    }
    request.raw.once('aborted', abort)
    reply.raw.once('close', abortOnClosedResponse)

    try {
        const normalized = validateQuoteRequest(request.body)
        const selection = await selectQuotes(normalized, controller.signal)
        const selected = selection.selectedQuote
        const approval = selected.approval
        request.log.debug({
            event: 'approval.metadata.api-response',
            hasApproval: Boolean(approval),
            mode: approval?.mode ?? null,
            contract: approval?.contract ?? null,
            spender: approval?.spender ?? null,
            token: approval?.token ?? null,
            requiredAmount: approval?.requiredAmount ?? null,
            provider: selected.provider,
            transactionTarget: selected.transaction.to,
            chainId: selected.chainId,
        }, 'Quote approval metadata serialized')
        const intent = await persistSwapIntent(
            normalized,
            selection.selectedQuote,
        )
        return reply.send({
            ...selection,
            ...(intent
                ? {
                      swapIntentId: intent.id,
                      gasAssistCompatible: intent.compatible,
                  }
                : {}),
        })
    } catch (error) {
        if (controller.signal.aborted || reply.raw.destroyed) {
            return reply
        }
        const safe = getSafeError(error)
        if (
            process.env.NODE_ENV !== 'production' &&
            'providers' in safe.body.error &&
            Array.isArray(safe.body.error.providers)
        ) {
            request.log.warn(
                { providers: safe.body.error.providers },
                'Quote providers returned no route',
            )
        }
        return reply.code(safe.statusCode).send(safe.body)
    } finally {
        request.raw.off('aborted', abort)
        reply.raw.off('close', abortOnClosedResponse)
    }
}

/**
 * Purpose: registers stable same-chain quote endpoints.
 * Inputs: a Fastify instance.
 * Output: a plugin serving unchanged `POST /v1/quote` and `POST /v1/swap/build` contracts.
 * Side effects: validates requests, calls providers, persists compatible intents, and logs diagnostics.
 * Errors: maps validation, provider, and abort failures through `getSafeError`.
 * Security: serializes normalized quotes and canonical approval metadata only.
 */
export const sameChainQuoteRoutes: FastifyPluginAsync = async (app) => {
    app.post<{ Body: unknown }>('/v1/quote', async (request, reply) =>
        handleQuote(request, reply),
    )

    app.post<{ Body: unknown }>('/v1/swap/build', async (request, reply) =>
        handleQuote(request, reply),
    )
}
