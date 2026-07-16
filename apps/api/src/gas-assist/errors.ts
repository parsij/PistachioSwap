export class GasAssistError extends Error {
    readonly code: string
    readonly statusCode: number
    readonly details: Record<string, string> | undefined

    constructor(
        code: string,
        message: string,
        statusCode = 400,
        details?: Record<string, string>,
    ) {
        super(message)
        this.name = 'GasAssistError'
        this.code = code
        this.statusCode = statusCode
        this.details = details
    }
}

export function gasAssistErrorBody(error: unknown) {
    if (error instanceof GasAssistError) {
        return {
            statusCode: error.statusCode,
            body: {
                error: {
                    code: error.code,
                    message: error.message,
                    ...(error.details ? { details: error.details } : {}),
                },
            },
        }
    }
    return {
        statusCode: 500,
        body: {
            error: {
                code: 'GAS_ASSIST_FAILED',
                message: 'Gas Assist could not complete the request.',
            },
        },
    }
}
