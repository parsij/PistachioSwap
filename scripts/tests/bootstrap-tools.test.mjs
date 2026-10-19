import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, delimiter } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = resolve(import.meta.dirname, '../..')
const launcher = join(root, 'scripts/run-frontend.sh')
const executable = (name) => spawnSync('/bin/sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim()
function script(file, contents) { writeFileSync(file, '#!/bin/bash\nset -eu\n' + contents + '\n', { mode: 0o755 }) }

for (const manager of ['apt-get', 'dnf', 'pacman', 'zypper', 'apk', 'brew']) {
    test(`missing Git uses ${manager} without invoking a real system installer`, () => {
        const temp = mkdtempSync(join(tmpdir(), 'pistachio-bootstrap-'))
        try {
            const bin = join(temp, 'bin'); mkdirSync(bin)
            for (const name of ['bash', 'curl', 'tar']) symlinkSync(executable(name), join(bin, name))
            symlinkSync(process.execPath, join(bin, 'node'))
            script(join(bin, 'id'), 'echo 0')
            script(join(bin, 'pnpm'), 'exit 0')
            script(join(temp, 'git-template'), 'if [[ "$1" == --version ]]; then echo git; exit 0; fi\nexit 77')
            script(join(bin, manager), 'echo "$*" >> "$CALLS"\n"$COPY" "$GIT_TEMPLATE" "$BIN/git"')
            const env = { ...process.env, PATH: bin, XDG_DATA_HOME: join(temp, 'data'), CALLS: join(temp, 'calls'), COPY: executable('cp'), GIT_TEMPLATE: join(temp, 'git-template'), BIN: bin }
            const result = spawnSync('/bin/bash', [launcher, '--dir', join(temp, 'checkout')], { env, encoding: 'utf8' })
            assert.equal(result.status, 77, result.stderr)
            const calls = readFileSync(env.CALLS, 'utf8')
            assert.match(calls, /git/)
            if (manager === 'apt-get') assert.match(calls, /^update\n/)
            if (manager === 'pacman') assert.ok(!calls.includes('-Sy'), 'must not initiate an Arch partial upgrade')
        } finally { rmSync(temp, { recursive: true, force: true }) }
    })
}

for (const validChecksum of [true, false]) {
    test(`private Node installation ${validChecksum ? 'verifies and installs the archive' : 'rejects a checksum mismatch before executing it'}`, () => {
        const temp = mkdtempSync(join(tmpdir(), 'pistachio-node-'))
        try {
            const bin = join(temp, 'bin'); const files = join(temp, 'node-files'); mkdirSync(bin); mkdirSync(join(files, 'bin'), { recursive: true })
            script(join(files, 'bin/node'), 'echo executed >> "$NODE_CALLS"\necho 24')
            const archive = 'node-v24.0.0-linux-x64.tar.gz'
            const tarResult = spawnSync('tar', ['-czf', join(temp, archive), '-C', files, '.'])
            assert.equal(tarResult.status, 0)
            const sha = validChecksum ? createHash('sha256').update(readFileSync(join(temp, archive))).digest('hex') : '0'.repeat(64)
            writeFileSync(join(temp, 'checksums'), `${sha}  ${archive}\n`)
            script(join(bin, 'node'), 'echo 26')
            script(join(bin, 'git'), 'if [[ "$1" == --version ]]; then echo git; exit 0; fi\nexit 77')
            script(join(bin, 'pnpm'), 'exit 0')
            script(join(bin, 'uname'), 'if [[ "$1" == -s ]]; then echo Linux; else echo x86_64; fi')
            script(join(bin, 'curl'), 'output="${@: -1}"\ncase "$*" in\n *SHASUMS256.txt*) cp "$FIXTURE/checksums" "$output" ;;\n *nodejs.org/dist/v24.0.0/node-v24.0.0-linux-x64.tar.gz*) cp "$FIXTURE/node-v24.0.0-linux-x64.tar.gz" "$output" ;;\n *) exit 88 ;;\nesac')
            const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, XDG_DATA_HOME: join(temp, 'data'), FIXTURE: temp, NODE_CALLS: join(temp, 'node-calls') }
            const result = spawnSync('/bin/bash', [launcher, '--dir', join(temp, 'checkout')], { env, encoding: 'utf8' })
            if (validChecksum) {
                assert.equal(result.status, 77, result.stderr)
                assert.ok(readFileSync(join(temp, 'data/pistachioswap/tools/node/bin/node'), 'utf8').includes('echo 24'))
                assert.ok(readFileSync(env.NODE_CALLS, 'utf8').includes('executed'))
            } else {
                assert.notEqual(result.status, 0)
                assert.match(result.stderr, /checksum verification failed/)
                assert.throws(() => readFileSync(env.NODE_CALLS))
            }
        } finally { rmSync(temp, { recursive: true, force: true }) }
    })
}
