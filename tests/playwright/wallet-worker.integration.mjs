import { readFile, readdir } from 'node:fs/promises'

import { Mnemonic, Wallet, keccak256, toUtf8Bytes } from 'ethers'
import { chromium } from 'playwright'
import { parseTransaction, recoverTransactionAddress } from 'viem'

const assets = await readdir(new URL('../../dist/assets/', import.meta.url))
const workerAsset = assets.find((name) => /^walletWorker-.*\.js$/u.test(name))
if (!workerAsset) throw new Error('Build the frontend before running the wallet worker integration test.')
const workerSource = await readFile(new URL(`../../dist/assets/${workerAsset}`, import.meta.url), 'utf8')

const mnemonic = Mnemonic.fromEntropy(new Uint8Array(16).fill(42)).phrase
const privateKey = keccak256(toUtf8Bytes('pistachio-wallet-worker-private-key-test-only'))
const privateWallet = new Wallet(privateKey)
const keystorePassword = 'test-only-backup-password'
const keystore = await privateWallet.encrypt(keystorePassword)

let browser
try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext()
    let unexpectedNetworkRequests = 0
    await context.route('**/*', async (route) => {
        const url = route.request().url()
        if (url === 'https://wallet-worker-test.pistachioswap.com/' && route.request().isNavigationRequest()) {
            await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><meta charset="utf-8">' })
        } else if (url === 'https://wallet-worker-test.pistachioswap.com/walletWorker.js') {
            await route.fulfill({ status: 200, contentType: 'text/javascript', body: workerSource })
        } else {
            unexpectedNetworkRequests += 1
            await route.abort()
        }
    })
    const page = await context.newPage()
    await page.goto('https://wallet-worker-test.pistachioswap.com/', { waitUntil: 'domcontentloaded' })
    const result = await page.evaluate(async ({ mnemonic, privateKey, keystore, keystorePassword }) => {
        const b64 = (bytes) => {
            let binary = ''
            for (const byte of bytes) binary += String.fromCharCode(byte)
            return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
        }
        const wrap = (id, byte) => ({
            id,
            credentialId: b64(new Uint8Array([byte])),
            credentialTransports: ['internal'],
            rpId: 'wallet-worker-test.pistachioswap.com',
            prfInput: b64(new Uint8Array(32).fill(byte)),
            hkdfSalt: b64(new Uint8Array(32).fill(byte + 1)),
            wrapIv: null,
            wrappedDek: null,
            label: 'Test passkey',
            createdAt: '2026-01-01T00:00:00.000Z',
            prfVerified: true,
        })
        const createClient = () => {
            const worker = new Worker('/walletWorker.js', { type: 'module' })
            let nextId = 1
            const pending = new Map()
            worker.addEventListener('message', (event) => {
                const request = pending.get(event.data.id)
                if (!request) return
                pending.delete(event.data.id)
                if (event.data.ok) request.resolve(event.data.result)
                else request.reject(Object.assign(new Error(event.data.error.message), { code: event.data.error.code }))
            })
            return {
                worker,
                request(operation, payload = {}, transfer = []) {
                    const id = nextId++
                    return new Promise((resolve, reject) => {
                        pending.set(id, { resolve, reject })
                        worker.postMessage({ id, operation, payload }, transfer)
                    })
                },
            }
        }
        const first = createClient()
        const primary = wrap('20000000-0000-4000-8000-000000000001', 1)
        const setupPrf = new Uint8Array(32).fill(7).buffer
        await first.request('setSetupPasskey', { keyWrap: primary, prfOutput: setupPrf }, [setupPrf])
        if (setupPrf.byteLength !== 0) throw new Error('Setup PRF buffer was not detached.')
        const imported = await first.request('importMnemonic', { mnemonic })
        const encrypted = await first.request('encryptVault', { vaultId: '20000000-0000-4000-8000-000000000002' })
        const verified = await first.request('verifyPersistedVault', { vault: encrypted.vault })
        if (verified.address !== imported.address) throw new Error('Persisted mnemonic address mismatch.')
        const messageSignature = await first.request('signMessage', { message: 'Pistachio worker test' })
        const typedSignature = await first.request('signTypedData', {
            domain: { name: 'Pistachio Worker Test', version: '1', chainId: 56, verifyingContract: '0x000000000000000000000000000000000000dEaD' },
            types: { Test: [{ name: 'value', type: 'uint256' }] },
            value: { value: 1 },
        })
        const transaction = {
            type: '0x0', chainId: '0x38', from: imported.address,
            to: '0x000000000000000000000000000000000000dEaD', nonce: '0x1',
            gas: '0x5208', gasPrice: '0x0', value: '0x0', data: '0x',
        }
        const signed = await first.request('signTransaction', { transaction, mode: 'megafuel' })
        await first.request('destroy')

        const second = createClient()
        const unlockPrf = new Uint8Array(32).fill(7).buffer
        const unlocked = await second.request('unlockVault', {
            vault: encrypted.vault,
            keyWrapId: primary.id,
            prfOutput: unlockPrf,
        }, [unlockPrf])
        if (unlockPrf.byteLength !== 0 || unlocked.address !== imported.address) throw new Error('Unlock round trip failed.')
        await second.request('destroy')

        const privateClient = createClient()
        const privatePrf = new Uint8Array(32).fill(8).buffer
        await privateClient.request('setSetupPasskey', { keyWrap: wrap('20000000-0000-4000-8000-000000000003', 2), prfOutput: privatePrf }, [privatePrf])
        const privateImported = await privateClient.request('importPrivateKey', { privateKey })
        await privateClient.request('destroy')

        const keystoreClient = createClient()
        const keystorePrf = new Uint8Array(32).fill(9).buffer
        await keystoreClient.request('setSetupPasskey', { keyWrap: wrap('20000000-0000-4000-8000-000000000004', 3), prfOutput: keystorePrf }, [keystorePrf])
        const keystoreImported = await keystoreClient.request('importKeystore', { json: keystore, password: keystorePassword })
        let unknownRejected = false
        try { await keystoreClient.request('unknownOperation') } catch { unknownRejected = true }
        await keystoreClient.request('destroy')
        return {
            address: imported.address,
            privateAddress: privateImported.address,
            keystoreAddress: keystoreImported.address,
            signedTransaction: signed.signedTransaction,
            messageSignatureLength: messageSignature.signature.length,
            typedSignatureLength: typedSignature.signature.length,
            unknownRejected,
        }
    }, { mnemonic, privateKey, keystore, keystorePassword })
    if (result.privateAddress !== privateWallet.address || result.keystoreAddress !== privateWallet.address) throw new Error('Private-key or V3 keystore import address mismatch.')
    if (result.messageSignatureLength !== 132 || result.typedSignatureLength !== 132 || !result.unknownRejected) throw new Error('Worker signing or protocol rejection failed.')
    const parsed = parseTransaction(result.signedTransaction)
    const signer = await recoverTransactionAddress({ serializedTransaction: result.signedTransaction })
    if (signer !== result.address || parsed.chainId !== 56 || parsed.type !== 'legacy' || (parsed.gasPrice ?? 0n) !== 0n || parsed.nonce !== 1 || parsed.gas !== 21_000n) {
        throw new Error('Exact worker MegaFuel transaction validation failed.')
    }
    if (unexpectedNetworkRequests !== 0) throw new Error('Wallet worker integration attempted an unexpected network request.')
    console.log('AUTOMATED-VERIFIED: bundled wallet worker mnemonic/private-key/V3 import, vault round trip, local signing, protocol rejection, and exact BSC zero-gas transaction passed.')
} finally {
    privateKey.fill?.(0)
    await browser?.close()
}
