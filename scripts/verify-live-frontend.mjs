import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const REPOSITORY = 'parsij/PistachioSwap'
const SIGNER_WORKFLOW = 'parsij/PistachioSwap/.github/workflows/deploy-vps.yml'
const MANIFEST_PATHS = [
    '/pistachio-build-manifest.json',
    '/.well-known/pistachio-build-manifest.json',
]
const CONCURRENCY = 8
const CLOUDFLARE_INSIGHTS_SCRIPT_SOURCE = String.raw`<script\b[^>]*\bsrc=(['"])https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js[^'"<>]*\1[^>]*><\/script>`
const CLOUDFLARE_EDGE_PATTERNS = [
    new RegExp(
        String.raw`<!--\s*Cloudflare Web Analytics\s*-->\s*${CLOUDFLARE_INSIGHTS_SCRIPT_SOURCE}\s*<!--\s*End Cloudflare Web Analytics\s*-->`,
        'gi',
    ),
    new RegExp(CLOUDFLARE_INSIGHTS_SCRIPT_SOURCE, 'gi'),
]

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

async function fetchManifest() {
    const failures = []
    const cacheBust = randomUUID()
    for (const manifestPath of MANIFEST_PATHS) {
        const url = new URL(manifestPath, `${origin}/`)
        url.searchParams.set('pistachio_verify', cacheBust)
        try {
            return {
                bytes: await fetchBytes(url.href),
                path: manifestPath,
            }
        } catch (error) {
            failures.push(error instanceof Error ? error.message : String(error))
        }
    }
    throw new Error(`Unable to fetch a production build manifest:\n- ${failures.join('\n- ')}`)
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

function knownEdgeHtmlCandidates(recordPath, bytes) {
    if (!recordPath.endsWith('.html')) return []
    const html = bytes.toString('utf8')
    const candidates = []
    for (const pattern of CLOUDFLARE_EDGE_PATTERNS) {
        pattern.lastIndex = 0
        const matches = [...html.matchAll(pattern)]
        if (matches.length !== 1) continue
        const match = matches[0]
        candidates.push(Buffer.from(
            html.slice(0, match.index) + html.slice(match.index + match[0].length),
            'utf8',
        ))
    }
    return candidates
}

function matchesRecord(bytes, record) {
    return bytes.length === record.bytes && sha256(bytes) === record.sha256.toLowerCase()
}

async function localAttestedBytes(record) {
    const relative = record.path.replace(/^\/+/, '')
    if (!relative || relative.includes('..')) return null
    try {
        const bytes = await readFile(path.join(process.cwd(), 'dist', relative))
        return matchesRecord(bytes, record) ? bytes : null
    } catch {
        return null
    }
}

function singleInsertedFragment(remote, expected) {
    if (remote.length <= expected.length) return null

    let prefix = 0
    const prefixLimit = Math.min(remote.length, expected.length)
    while (prefix < prefixLimit && remote[prefix] === expected[prefix]) prefix += 1

    let suffix = 0
    const maxSuffix = expected.length - prefix
    while (
        suffix < maxSuffix &&
        remote[remote.length - 1 - suffix] === expected[expected.length - 1 - suffix]
    ) {
        suffix += 1
    }

    if (prefix + suffix !== expected.length) return null
    const insertionEnd = remote.length - suffix
    if (insertionEnd <= prefix) return null
    return remote.subarray(prefix, insertionEnd)
}

function isKnownCloudflareInsertion(fragment) {
    const text = fragment.toString('utf8')
    if (text.length === 0 || text.length > 8_192) return false
    return text.includes('static.cloudflareinsights.com') ||
        text.includes('Cloudflare Web Analytics') ||
        text.includes('/cdn-cgi/challenge-platform/') ||
        text.includes('__CF$cv$params')
}

async function verifyRecord(record, cacheBust) {
    const url = new URL(record.path, `${origin}/`)
    // Some public HTML/icon routes intentionally have shared-cache TTLs. Verify
    // the newly deployed release through a distinct cache key instead of
    // comparing a fresh manifest to an older, still-valid CDN cache entry.
    url.searchParams.set('pistachio_verify', cacheBust)
    const bytes = await fetchBytes(url.href)
    if (matchesRecord(bytes, record)) return

    // First handle the documented Web Analytics wrapper for standalone verifier
    // use, where a local dist directory may not exist.
    for (const normalized of knownEdgeHtmlCandidates(record.path, bytes)) {
        if (matchesRecord(normalized, record)) return
    }

    // CI still has the exact attested dist bytes. If Cloudflare injected one
    // contiguous fragment after the origin response, prove that removing only
    // that fragment recreates the attested file byte-for-byte, and only accept
    // it when the inserted bytes identify Cloudflare's own edge instrumentation.
    if (record.path.endsWith('.html')) {
        const expected = await localAttestedBytes(record)
        if (expected) {
            const insertion = singleInsertedFragment(bytes, expected)
            if (insertion && isKnownCloudflareInsertion(insertion)) return
        }
    }

    if (bytes.length !== record.bytes) {
        throw new Error(`${record.path}: expected ${record.bytes} bytes, received ${bytes.length}`)
    }
    throw new Error(`${record.path}: SHA-256 mismatch`)
}

async function verifyFiles(records, cacheBust) {
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
                await verifyRecord(record, cacheBust)
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
const fetchedManifest = await fetchManifest()
const manifestBytes = fetchedManifest.bytes
const manifest = JSON.parse(manifestBytes.toString('utf8'))
validateManifest(manifest)

console.log(`Manifest: ${fetchedManifest.path}`)
console.log(`Source commit: ${manifest.source.commit}`)
await verifyAttestation(manifestBytes, manifest)
await verifyFiles(manifest.files, manifest.source.commit)
await checkMainHead(manifest)

console.log(`✓ ${origin} matches the GitHub-attested PistachioSwap frontend build.`)
