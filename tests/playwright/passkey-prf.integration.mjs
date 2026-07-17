import { chromium } from 'playwright'

const TEST_ORIGIN = 'https://passkey-test.pistachioswap.com/'
const TEST_RP_ID = 'passkey-test.pistachioswap.com'

function failPartial(message) {
    console.error(`PARTIAL: ${message}`)
    process.exitCode = 2
}

let browser
try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()
    let unexpectedNetworkRequests = 0
    await context.route('**/*', async (route) => {
        if (route.request().url() === TEST_ORIGIN && route.request().isNavigationRequest()) {
            await route.fulfill({
                status: 200,
                contentType: 'text/html',
                body: '<!doctype html><meta charset="utf-8"><title>Passkey PRF integration</title>',
            })
            return
        }
        unexpectedNetworkRequests += 1
        await route.abort()
    })
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    await cdp.send('WebAuthn.enable', { enableUI: false })
    const positive = await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: {
            protocol: 'ctap2',
            ctap2Version: 'ctap2_1',
            transport: 'internal',
            hasResidentKey: true,
            hasUserVerification: true,
            hasPrf: true,
            automaticPresenceSimulation: true,
            isUserVerified: true,
        },
    })
    await page.goto(TEST_ORIGIN, { waitUntil: 'domcontentloaded' })
    const positiveResult = await page.evaluate(async ({ rpId }) => {
        const random = (length) => crypto.getRandomValues(new Uint8Array(length))
        const b64 = (value) => {
            let binary = ''
            for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte)
            return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
        }
        const equal = (left, right) => left.length === right.length && left.every((byte, index) => byte === right[index])
        const prfInput = random(32)
        const credential = await navigator.credentials.create({
            publicKey: {
                rp: { id: rpId, name: 'PistachioSwap' },
                user: { id: random(32), name: 'virtual-test', displayName: 'Pistachio Wallet PRF Test' },
                challenge: random(32),
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
                authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
                attestation: 'none',
                extensions: { prf: { eval: { first: prfInput } }, credProps: true },
            },
        })
        if (!(credential instanceof PublicKeyCredential)) throw new Error('Registration did not return PublicKeyCredential.')
        if (credential.getClientExtensionResults()?.prf?.enabled !== true) throw new Error('Registration did not report prf.enabled.')
        const credentialId = b64(credential.rawId)
        async function assertion(input) {
            const result = await navigator.credentials.get({
                publicKey: {
                    challenge: random(32),
                    rpId,
                    allowCredentials: [{ type: 'public-key', id: credential.rawId }],
                    userVerification: 'required',
                    extensions: { prf: { evalByCredential: { [credentialId]: { first: input } } } },
                },
            })
            const output = result.getClientExtensionResults()?.prf?.results?.first
            if (!output || output.byteLength !== 32) throw new Error('Assertion PRF output was not 32 bytes.')
            return new Uint8Array(output)
        }
        const first = await assertion(prfInput)
        const second = await assertion(prfInput)
        if (!equal(first, second)) throw new Error('Repeated PRF output changed.')
        const differentInput = random(32)
        const different = await assertion(differentInput)
        if (equal(first, different)) throw new Error('Different PRF input produced the same output.')

        const hkdfSalt = random(32)
        const info = new TextEncoder().encode(`PistachioSwap/passkey-vault-wrap/v1/00000000-0000-4000-8000-000000000001/${rpId}`)
        async function deriveKek(prf) {
            const ikm = await crypto.subtle.importKey('raw', prf, 'HKDF', false, ['deriveKey'])
            return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: hkdfSalt, info }, ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
        }
        const fakeDek = random(32)
        const wrapIv = random(12)
        const wrapAad = new TextEncoder().encode('PistachioSwap/test-wrap-aad/v1')
        const kek = await deriveKek(first)
        const wrappedDek = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIv, additionalData: wrapAad }, kek, fakeDek)
        const payloadIv = random(12)
        const payloadAad = new TextEncoder().encode('PistachioSwap/test-payload-aad/v1')
        const payloadKey = await crypto.subtle.importKey('raw', fakeDek, 'AES-GCM', false, ['encrypt'])
        const expected = new TextEncoder().encode('{"fakeWallet":"deterministic-test-only","chainId":56}')
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: payloadIv, additionalData: payloadAad }, payloadKey, expected)

        first.fill(0)
        second.fill(0)
        different.fill(0)
        fakeDek.fill(0)

        const reproduced = await assertion(prfInput)
        const reproducedKek = await deriveKek(reproduced)
        const unwrapped = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: wrapIv, additionalData: wrapAad }, reproducedKek, wrappedDek)
        const decryptKey = await crypto.subtle.importKey('raw', unwrapped, 'AES-GCM', false, ['decrypt'])
        const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: payloadIv, additionalData: payloadAad }, decryptKey, ciphertext))
        reproduced.fill(0)
        new Uint8Array(unwrapped).fill(0)
        return {
            registrationPrfEnabled: true,
            outputLength: 32,
            sameInputStable: true,
            differentInputSeparated: true,
            encryptionRoundTrip: equal(plaintext, expected),
        }
    }, { rpId: TEST_RP_ID })
    if (!positiveResult.encryptionRoundTrip) throw new Error('Encrypted fake payload did not round trip.')

    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: positive.authenticatorId })
    const negative = await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: {
            protocol: 'ctap2',
            ctap2Version: 'ctap2_1',
            transport: 'internal',
            hasResidentKey: true,
            hasUserVerification: true,
            hasPrf: false,
            automaticPresenceSimulation: true,
            isUserVerified: true,
        },
    })
    const negativeFailedClosed = await page.evaluate(async ({ rpId }) => {
        const random = (length) => crypto.getRandomValues(new Uint8Array(length))
        try {
            const credential = await navigator.credentials.create({
                publicKey: {
                    rp: { id: rpId, name: 'PistachioSwap' },
                    user: { id: random(32), name: 'negative-virtual-test', displayName: 'Negative PRF Test' },
                    challenge: random(32),
                    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
                    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
                    attestation: 'none',
                    extensions: { prf: { eval: { first: random(32) } } },
                },
            })
            return credential.getClientExtensionResults()?.prf?.enabled !== true
        } catch {
            return true
        }
    }, { rpId: TEST_RP_ID })
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: negative.authenticatorId })
    if (!negativeFailedClosed) throw new Error('PRF-disabled authenticator did not fail closed.')
    if (unexpectedNetworkRequests !== 0) throw new Error('The test attempted an unexpected network request.')
    console.log('AUTOMATED-VERIFIED: Chromium WebAuthn PRF, HKDF, AES-GCM round trip, and PRF-disabled fail-closed test passed; no backend or provider request occurred.')
} catch (error) {
    failPartial(error?.message ?? String(error))
} finally {
    await browser?.close()
}
