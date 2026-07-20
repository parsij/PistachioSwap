function runDiagnosticWorker(operation, payload, prfOutput) {
    const worker = new Worker(new URL('./passkeyDiagnosticWorker.js', import.meta.url), { type: 'module', name: 'pistachio-passkey-diagnostic' })
    return new Promise((resolve, reject) => {
        const id = 1
        const cleanup = () => worker.terminate()
        worker.addEventListener('message', (event) => {
            cleanup()
            if (event.data?.id === id && event.data.ok) resolve(event.data.result)
            else {
                const error = new Error(event.data?.error?.message ?? 'Passkey diagnostic failed.')
                error.code = event.data?.error?.code ?? 'PISTACHIO_DIAGNOSTIC_FAILED'
                reject(error)
            }
        }, { once: true })
        worker.addEventListener('error', () => {
            cleanup()
            reject(new Error('Passkey diagnostic worker failed.'))
        }, { once: true })
        worker.postMessage({ id, operation, payload: { ...payload, prfOutput } }, [prfOutput])
    })
}

/** Encrypts the fixed diagnostic payload with a supplied passkey PRF result; used only by diagnostics. */
export function encryptDiagnosticPayload(keyWrap, prfOutput) {
    return runDiagnosticWorker('encrypt', { keyWrap, vaultId: crypto.randomUUID() }, prfOutput)
}

/** Decrypts and verifies a diagnostic vault payload, throwing when PRF binding or ciphertext is invalid. */
export function unlockDiagnosticPayload(vault, keyWrapId, prfOutput) {
    return runDiagnosticWorker('unlock', { vault, keyWrapId }, prfOutput)
}
