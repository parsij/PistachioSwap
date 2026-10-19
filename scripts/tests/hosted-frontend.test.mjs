import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { hostedApiProxy, readPublicFrontendEnvironment } from '../hosted-frontend-config.mjs'

const root = resolve(import.meta.dirname, '../..')
const manifest = {
    schemaVersion: 1, project: 'PistachioSwap', origin: 'https://pistachioswap.com',
    source: { repository: 'parsij/PistachioSwap', commit: 'a'.repeat(40) },
    build: { publicEnvironment: { VITE_REOWN_PROJECT_ID: 'a'.repeat(32), VITE_GAS_ASSIST_ENABLED: 'true' } },
}

test('public configuration is validated and cannot set process or private environment fields', () => {
    const input = structuredClone(manifest)
    input.build.publicEnvironment.NODE_OPTIONS = '--import=evil'
    input.build.publicEnvironment.PRIVATE_KEY = 'not-browser-configuration'
    assert.deepEqual(readPublicFrontendEnvironment(input), manifest.build.publicEnvironment)
    assert.throws(() => readPublicFrontendEnvironment({ ...input, origin: 'https://untrusted.example' }))
    assert.throws(() => readPublicFrontendEnvironment({ ...input, build: {} }))
    input.build.publicEnvironment.VITE_REOWN_PROJECT_ID = ''
    assert.throws(() => readPublicFrontendEnvironment(input))
})

test('fixed public API proxy removes client-supplied location/cookie evidence but preserves authorization', () => {
    const config = hostedApiProxy()
    assert.equal(config.target, 'https://pistachioswap.com')
    assert.equal(config.secure, true)
    const proxy = new EventEmitter()
    config.configure(proxy)
    const headers = new Map(Object.entries({
        origin: 'http://localhost:5173', cookie: 'unrelated-browser-cookie',
        'cf-ipcountry': 'US', 'cf-connecting-ip': 'fake', 'x-forwarded-for': 'fake',
        authorization: 'Bearer test-wallet-session', 'content-type': 'application/json',
    }))
    proxy.emit('proxyReq', {
        getHeaderNames: () => [...headers.keys()],
        removeHeader: (name) => headers.delete(name),
    })
    assert.deepEqual([...headers.keys()], ['authorization', 'content-type'])
})

test('launcher clones once into a custom folder, fast-forwards later, and preserves local work', () => {
    const temp = mkdtempSync(join(tmpdir(), 'pistachio-launcher-'))
    try {
        const bin = join(temp, 'bin')
        const upstream = join(temp, 'upstream')
        const destination = join(temp, 'custom folder', 'frontend')
        const calls = join(temp, 'calls')
        mkdirSync(bin)
        const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
        const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, TEST_REMOTE: upstream, REAL_GIT: realGit, CALLS: calls,
            GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' }
        function git(args, cwd = temp) {
            const result = spawnSync(realGit, args, { cwd, env, encoding: 'utf8' })
            assert.equal(result.status, 0, result.stderr)
            return result.stdout.trim()
        }
        git(['init', '--initial-branch=main', upstream])
        writeFileSync(join(upstream, 'version'), 'first')
        git(['add', '.'], upstream)
        git(['commit', '-m', 'first'], upstream)
        writeFileSync(join(bin, 'git'), `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == clone ]]; then
    echo clone >> "$CALLS"
    destination="\${@: -1}"
    "$REAL_GIT" clone --branch main --single-branch "$TEST_REMOTE" "$destination"
    "$REAL_GIT" -C "$destination" remote set-url origin https://github.com/parsij/PistachioSwap.git
elif [[ "$1" == -C && "$3" == fetch ]]; then
    echo fetch >> "$CALLS"
    "$REAL_GIT" -C "$2" fetch "$TEST_REMOTE" main:refs/remotes/origin/main
else
    exec "$REAL_GIT" "$@"
fi
`, { mode: 0o755 })
        writeFileSync(join(bin, 'pnpm'), '#!/usr/bin/env bash\nprintf "pnpm %s\\n" "$*" >> "$CALLS"\n', { mode: 0o755 })
        const launch = (args = ['--dir', destination], cwd = temp) => spawnSync('bash', [join(root, 'scripts/run-frontend.sh'), ...args], { cwd, env, encoding: 'utf8' })
        let result = launch()
        assert.equal(result.status, 0, result.stderr)
        assert.equal(readFileSync(join(destination, 'version'), 'utf8'), 'first')
        writeFileSync(join(upstream, 'version'), 'second')
        git(['add', '.'], upstream)
        git(['commit', '-m', 'second'], upstream)
        result = launch()
        assert.equal(result.status, 0, result.stderr)
        assert.equal(readFileSync(join(destination, 'version'), 'utf8'), 'second')
        const events = readFileSync(calls, 'utf8').split('\n')
        assert.equal(events.filter((line) => line === 'clone').length, 1)
        assert.equal(events.filter((line) => line === 'fetch').length, 1)
        assert.equal(events.filter((line) => line === 'pnpm self-host').length, 2)
        result = launch([], destination)
        assert.equal(result.status, 0, result.stderr)
        assert.equal(readFileSync(calls, 'utf8').split('\n').filter((line) => line === 'clone').length, 1)
        writeFileSync(join(destination, 'version'), 'my local work')
        result = launch()
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /Local changes/)
        assert.equal(readFileSync(join(destination, 'version'), 'utf8'), 'my local work')
        git(['add', '.'], destination)
        git(['commit', '-m', 'local work'], destination)
        result = launch()
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /Local commits/)
        assert.equal(readFileSync(join(destination, 'version'), 'utf8'), 'my local work')
        git(['remote', 'set-url', 'origin', 'https://github.com/other/unrelated.git'], destination)
        result = launch()
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /unexpected origin/)
    } finally {
        rmSync(temp, { recursive: true, force: true })
    }
})
