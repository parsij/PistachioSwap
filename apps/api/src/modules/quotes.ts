import type {
    FastifyPluginAsync,
    FastifyReply,
    FastifyRequest,
} from 'fastify'

import { getSafeError } from '../lib/errors.js'
import { createQuoteSelector } from '../providers/quotes/quote-selector.js'
import { validateQuoteRequest } from '../providers/quotes/quote-utils.js'

const selectQuotes = createQuoteSelector()

async function handleQuote(
    request: FastifyRequest<{ Body: unknown }>,
    reply: FastifyReply,
) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    request.raw.once('aborted', abort)

    try {
        const normalized = validateQuoteRequest(request.body)
        const selection = await selectQuotes(normalized, controller.signal)
        return reply.send(selection)
    } catch (error) {
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
    }
}

export const quoteRoutes: FastifyPluginAsync = async (app) => {
    app.post<{ Body: unknown }>('/v1/quote', async (request, reply) =>
        handleQuote(request, reply),
    )

    app.post<{ Body: unknown }>('/v1/swap/build', async (request, reply) =>
        handleQuote(request, reply),
    )
}
