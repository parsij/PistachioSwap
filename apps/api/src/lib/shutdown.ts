export function createShutdownHandler(
    close: () => Promise<void>,
    onError: (error: unknown) => void,
) {
    let closing: Promise<void> | null = null

    return () => {
        if (!closing) {
            closing = close().catch((error) => {
                onError(error)
            })
        }
        return closing
    }
}
