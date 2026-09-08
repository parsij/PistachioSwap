import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const REPOSITORY = 'parsij/PistachioSwap'
const SIGNER_WORKFLOW = 'parsij/PistachioSwap/.github/workflows/deploy-vps.yml'
const MANIFEST_PATH = '/.well-known/pistachio-build-manifest.json'
const CONCURRENCY = 8

const args = process.argv.slice(2)
const skipAttestationIndex = args.indexOf('--skip-attestation')
const skipAttestation = skipAttestationIndex !== -1
if (skipAttestation) args.splice(skipAttestationIndex, 1)

const requestedOrigin = args[0] || 'https://pistachioswap.com'
const originUrl = new URL(requestedOrigin)
if (originUrl.protocol !== 'https:') throw new Error('Verification target must use HTTPS.')
const origin = originUrl.origin

function sha256(buffer) {
    return createHash('sha256').update(buffer).digest('hex')
}

function validateManifest(manifest) {
    if (manifest?.schemaVersion !== 1 || manifest?.project !== 'PistachioSwap') {
        throw new Error('The live build manifest has an unsupported schema or project name.')
    }
    if (manifest.origin !== origin) {
        throw new Error(`Manifest origin ${manifest.origin} does not match verification target ${origin}.`)
    }
    if (manifest?.source?.repository !== REPOSITORY) {
        throw new Error(`Unexpected source repository: ${manifest?.source?.repository}`)
    }
    if (manifest?.source?.workflow !== '.github/workflows/deploy-vps.yml') {
        throw new Error(`Unexpected build workflow: ${manifest?.source?.workflow}`)
    }
    if (manifest?.source?.ref !== 'refs/heads/main') {
        throw new Error(`Unexpected source ref: ${manifest?.source?.ref}`)
    }
    if (!/^[0-9a-f]{40}$/i.test(String(manifest?.source?.commit ?? ''))) {
        throw new Error('Manifest source commit is not a full Git SHA.')
    }
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
        throw new Error('Manifest does not contain frontend files.')
    }

    const seen = new Set()
    for (const record of manifest.files) {
        const filePath = String(record?.path ?? '')
        if (!filePath.startsWith('/') || filePath.includes('\\') || filePath.includes('..')) {
            throw new Error(`Unsafe manifest path: ${filePath}`)
        }
        if (seen.has(filePath)) throw new Error(`Duplicate manifest path: ${filePath}`)
        seen.add(filePath)
        if (!/^[0-9a-f]{64}$/i.test(String(record?.sha256 ?? ''))) {
            throw new Error(`Invalid SHA-256 in manifest for ${filePath}`)
        }
        if (!Number.isSafeInteger(record?.bytes) || record.bytes < 0) {
            throw new Error(`Invalid byte length in manifest for ${filePath}`)
        }
    }
}

async function fetchBytes(url) {
    const response = await fetch(url, {
        redirect: 'follow',
        headers: {
            accept: '*/*',
            'cache-control': 'no-cache',
            pragma: 'no-cache',
            'user-agent': 'PistachioSwap-Frontend-Verifier/1',
        },
        signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
}

async function verifyAttestation(manifestBytes, manifest) {
    if (skipAttestation) {
        console.warn('WARNING: GitHub provenance verification was explicitly skipped.')
        return
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'pistachio-verify-'))
    const tempManifest = path.join(tempDir, 'pistachio-build-manifest.json')
    try {
        await writeFile(tempManifest, manifestBytes)
        const result = spawnSync('gh', [
            'attestation',
            'verify',
            tempManifest,
            '--repo', REPOSITORY,
            '--signer-workflow', SIGNER_WORKFLOW,
            '--source-ref', 'refs/heads/main',
            '--source-digest', manifest.source.commit,
            '--deny-self-hosted-runners',
        ], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        })

        if (result.error?.code === 'ENOENT') {
            throw new Error('GitHub CLI (gh) is required for provenance verification. Install gh, authenticate it, and retry.')
        }
        if (result.status !== 0) {
            const detail = String(result.stderr || result.stdout || '').trim()
            throw new Error(`GitHub build attestation verification failed${detail ? `: ${detail}` : '.'}`)
        }
        console.log('✓ GitHub build provenance verified')
    } finally {
        await rm(tempDir, { recursive: true, force: true })
    }
}

async function verifyRecord(record) {
    const url = new URL(record.path, `${origin}/`).href
    const bytes = await fetchBytes(url)
    if (bytes.length !== record.bytes) {
        throw new Error(`${record.path}: expected ${record.bytes} bytes, received ${bytes.length}`)
    }
    const digest = sha256(bytes)
    if (digest !== record.sha256.toLowerCase()) {
        throw new Error(`${record.path}: SHA-256 mismatch`)
    }
}

async function verifyFiles(records) {
    let nextIndex = 0
    let verified = 0
    const failures = []

    async function worker() {
        while (true) {
            const index = nextIndex
            nextIndex += 1
            if (index >= records.length) return
            const record = records[index]
            try {
                await verifyRecord(record)
                verified += 1
                if (verified % 25 === 0 || verified === records.length) {
                    console.log(`  ${verified}/${records.length} production files verified`)
                }
            } catch (error) {
                failures.push(error instanceof Error ? error.message : String(error))
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, records.length) }, () => worker()))
    if (failures.length > 0) {
        throw new Error(`Live frontend verification failed:\n- ${failures.join('\n- ')}`)
    }
}

async function checkMainHead(manifest) {
    try {
        const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/commits/main`, {
            headers: {
                accept: 'application/vnd.github+json',
                'user-agent': 'PistachioSwap-Frontend-Verifier/1',
            },
            signal: AbortSignal.timeout(10_000),
        })
        if (!response.ok) return
        const payload = await response.json()
        if (/^[0-9a-f]{40}$/i.test(String(payload?.sha ?? '')) && payload.sha !== manifest.source.commit) {
            console.warn(`NOTICE: verified deployment commit ${manifest.source.commit} is not current main ${payload.sha}.`)
        }
    } catch {
        // Main-head freshness is informational. Provenance and byte hashes are the security checks.
    }
}

console.log(`Verifying ${origin}`)
const manifestBytes = await fetchBytes(new URL(MANIFEST_PATH, `${origin}/`).href)
const manifest = JSON.parse(manifestBytes.toString('utf8'))
validateManifest(manifest)

console.log(`Source commit: ${manifest.source.commit}`)
await verifyAttestation(manifestBytes, manifest)
await verifyFiles(manifest.files)
await checkMainHead(manifest)

console.log(`✓ ${origin} matches the GitHub-attested PistachioSwap frontend build.`)
