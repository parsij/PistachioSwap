import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DIST_DIR = path.resolve(process.cwd(), process.argv[2] || 'dist')
const MANIFEST_RELATIVE_PATH = '.well-known/pistachio-build-manifest.json'
const MANIFEST_PATH = path.join(DIST_DIR, MANIFEST_RELATIVE_PATH)

function normalizeManifestPath(value) {
    const text = String(value ?? '')
    if (!text.startsWith('/') || text.includes('\\') || text.includes('..')) {
        throw new Error(`Unsafe manifest path: ${text}`)
    }
    return text.slice(1)
}

async function walk(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true })
    const files = []
    for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
        const absolute = path.join(directory, entry.name)
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
            files.push(...await walk(absolute, relative))
        } else if (entry.isFile() && relative !== MANIFEST_RELATIVE_PATH) {
            files.push(relative)
        }
    }
    return files
}

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
if (manifest?.schemaVersion !== 1 || manifest?.project !== 'PistachioSwap') {
    throw new Error('Frontend verification manifest has an unsupported schema or project name.')
}
if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('Frontend verification manifest contains no files.')
}

const expectedPaths = new Set()
for (const record of manifest.files) {
    const relativePath = normalizeManifestPath(record.path)
    if (expectedPaths.has(relativePath)) throw new Error(`Duplicate manifest path: ${record.path}`)
    expectedPaths.add(relativePath)

    if (!/^[0-9a-f]{64}$/i.test(String(record.sha256 ?? ''))) {
        throw new Error(`Invalid SHA-256 for ${record.path}`)
    }
    if (!Number.isSafeInteger(record.bytes) || record.bytes < 0) {
        throw new Error(`Invalid byte length for ${record.path}`)
    }

    const absolute = path.join(DIST_DIR, ...relativePath.split('/'))
    const [buffer, metadata] = await Promise.all([readFile(absolute), stat(absolute)])
    if (metadata.size !== record.bytes) {
        throw new Error(`Byte-length mismatch for ${record.path}: expected ${record.bytes}, got ${metadata.size}`)
    }
    const digest = createHash('sha256').update(buffer).digest('hex')
    if (digest !== record.sha256.toLowerCase()) {
        throw new Error(`SHA-256 mismatch for ${record.path}`)
    }
}

const actualPaths = new Set(await walk(DIST_DIR))
for (const expected of expectedPaths) {
    if (!actualPaths.has(expected)) throw new Error(`Manifest file is missing from dist: /${expected}`)
}
for (const actual of actualPaths) {
    if (!expectedPaths.has(actual)) throw new Error(`Unmanifested production file found in dist: /${actual}`)
}

console.log(`Verified ${expectedPaths.size} frontend files against ${MANIFEST_RELATIVE_PATH}.`)
