import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { loadEnv } from 'vite'

const ROOT = process.cwd()
const DIST_DIR = path.resolve(ROOT, process.argv[2] || 'dist')
const MANIFEST_RELATIVE_PATH = '.well-known/pistachio-build-manifest.json'
const PUBLIC_MANIFEST_RELATIVE_PATH = 'pistachio-build-manifest.json'
const MANIFEST_PATH = path.join(DIST_DIR, MANIFEST_RELATIVE_PATH)
const PUBLIC_MANIFEST_PATH = path.join(DIST_DIR, PUBLIC_MANIFEST_RELATIVE_PATH)
const MANIFEST_ALIASES = new Set([
    MANIFEST_RELATIVE_PATH,
    PUBLIC_MANIFEST_RELATIVE_PATH,
])

function requireValue(name, fallback = '') {
    const value = String(process.env[name] ?? fallback).trim()
    if (!value) throw new Error(`Missing required build metadata: ${name}`)
    return value
}

function assertCommit(value) {
    if (!/^[0-9a-f]{40}$/i.test(value)) {
        throw new Error(`PISTACHIO_SOURCE_COMMIT must be a 40-character Git commit SHA, got ${value}`)
    }
    return value.toLowerCase()
}

function assertOrigin(value) {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:') throw new Error('Production origin must use HTTPS.')
    return parsed.origin
}

function sortedObject(value) {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
}

async function walk(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true })
    const files = []
    for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
        const absolute = path.join(directory, entry.name)
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
            files.push(...await walk(absolute, relative))
        } else if (entry.isFile() && !MANIFEST_ALIASES.has(relative)) {
            files.push(relative)
        }
    }
    return files
}

async function fileRecord(relativePath) {
    const absolute = path.join(DIST_DIR, ...relativePath.split('/'))
    const [buffer, metadata] = await Promise.all([readFile(absolute), stat(absolute)])
    return {
        path: `/${relativePath}`,
        bytes: metadata.size,
        sha256: createHash('sha256').update(buffer).digest('hex'),
    }
}

const repository = requireValue('GITHUB_REPOSITORY', 'parsij/PistachioSwap')
const commit = assertCommit(requireValue('PISTACHIO_SOURCE_COMMIT', process.env.GITHUB_SHA))
const ref = requireValue('PISTACHIO_SOURCE_REF', process.env.GITHUB_REF || 'refs/heads/main')
const origin = assertOrigin(requireValue('PISTACHIO_PUBLIC_ORIGIN', 'https://pistachioswap.com'))
const workflow = requireValue('PISTACHIO_BUILD_WORKFLOW', '.github/workflows/deploy-vps.yml')
const packageJson = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'))

const loadedPublicEnvironment = loadEnv('production', ROOT, 'VITE_')
for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('VITE_') && value !== undefined) {
        loadedPublicEnvironment[key] = value
    }
}

const files = []
for (const relativePath of await walk(DIST_DIR)) {
    files.push(await fileRecord(relativePath))
}

if (!files.some((entry) => entry.path === '/index.html')) {
    throw new Error('Production build is missing /index.html.')
}
if (!files.some((entry) => entry.path === '/swap/index.html')) {
    throw new Error('Production build is missing /swap/index.html.')
}

const workflowRun = process.env.GITHUB_RUN_ID
    ? `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}` +
      (process.env.GITHUB_RUN_ATTEMPT ? `/attempts/${process.env.GITHUB_RUN_ATTEMPT}` : '')
    : null

const manifest = {
    schemaVersion: 1,
    project: 'PistachioSwap',
    origin,
    source: {
        repository,
        commit,
        ref,
        workflow,
        workflowRun,
    },
    build: {
        mode: 'production',
        node: process.version,
        packageManager: String(packageJson.packageManager ?? ''),
        publicEnvironment: sortedObject(loadedPublicEnvironment),
    },
    files,
}

const manifestText = `${JSON.stringify(manifest, null, 2)}\n`
await mkdir(path.dirname(MANIFEST_PATH), { recursive: true })
await Promise.all([
    writeFile(MANIFEST_PATH, manifestText, 'utf8'),
    writeFile(PUBLIC_MANIFEST_PATH, manifestText, 'utf8'),
])

console.log(
    `Wrote ${PUBLIC_MANIFEST_RELATIVE_PATH} and ${MANIFEST_RELATIVE_PATH} with ${files.length} hashed production files.`,
)
