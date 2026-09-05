import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const script = path.resolve('scripts/deploy/sync-shared-api-env.mjs')
const cleanups = []

async function fixture(leftText, rightText) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pistachio-env-sync-'))
    cleanups.push(root)
    const leftDir = path.join(root, 'pistachio-env')
    const rightDir = path.join(root, 'gas-env')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(leftDir)
    await mkdir(rightDir)
    const left = path.join(leftDir, 'api.env')
    const right = path.join(rightDir, 'api.env')
    const logFile = path.join(root, 'shared-env-sync.log')
    await writeFile(left, leftText)
    await writeFile(right, rightText)
    return { left, right, leftDir, rightDir, logFile }
}

async function run(left, right, logFile, extraArgs = []) {
    return execFileAsync(process.execPath, [
        script,
        '--required',
        '--left', left,
        '--right', right,
        '--log-file', logFile,
        ...extraArgs,
    ])
}

afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('shared API environment synchronizer', () => {
    it('copies missing shared settings both directions without copying service-only settings', async () => {
        const { left, right, logFile } = await fixture(
            'PORT=3006\nCOMPLIANCE_ENABLED=true\nOFAC_MAX_LIST_AGE_MS=86400000\n',
            'PORT=3002\nGAS_ASSIST_INTERNAL_TOKEN=shared-secret-token\n',
        )

        await run(left, right, logFile)

        const leftText = await readFile(left, 'utf8')
        const rightText = await readFile(right, 'utf8')
        expect(leftText).toContain('GAS_ASSIST_INTERNAL_TOKEN=shared-secret-token')
        expect(rightText).toContain('COMPLIANCE_ENABLED=true')
        expect(rightText).toContain('OFAC_MAX_LIST_AGE_MS=86400000')
        expect(leftText).toContain('PORT=3006')
        expect(leftText).not.toContain('PORT=3002')
        expect(rightText).toContain('PORT=3002')
        expect(rightText).not.toContain('PORT=3006')
    })

    it('fails closed on an unexplained startup conflict without printing or logging secret values', async () => {
        const leftSecret = 'left-super-secret-value'
        const rightSecret = 'right-super-secret-value'
        const { left, right, logFile } = await fixture(
            `GAS_ASSIST_INTERNAL_TOKEN=${leftSecret}\n`,
            `GAS_ASSIST_INTERNAL_TOKEN=${rightSecret}\n`,
        )

        let failure
        try {
            await run(left, right, logFile)
        } catch (error) {
            failure = error
        }

        expect(failure).toBeTruthy()
        expect(failure.code).toBe(78)
        expect(failure.stderr).toContain('GAS_ASSIST_INTERNAL_TOKEN')
        expect(failure.stderr).not.toContain(leftSecret)
        expect(failure.stderr).not.toContain(rightSecret)
        const log = await readFile(logFile, 'utf8')
        expect(log).toContain('GAS_ASSIST_INTERNAL_TOKEN')
        expect(log).not.toContain(leftSecret)
        expect(log).not.toContain(rightSecret)
    })

    it('propagates an operator edit from Pistachio to Gas Assist', async () => {
        const { left, right, logFile } = await fixture(
            'COMPLIANCE_BLOCKED_COUNTRY_CODES=CU,IR,KP,RU,UA\n',
            'COMPLIANCE_BLOCKED_COUNTRY_CODES=CU,IR,KP\n',
        )

        await run(left, right, logFile, ['--source', 'left'])

        expect(await readFile(right, 'utf8')).toContain('COMPLIANCE_BLOCKED_COUNTRY_CODES=CU,IR,KP,RU,UA')
        const log = await readFile(logFile, 'utf8')
        expect(log).toContain('Propagated shared keys')
        expect(log).toContain('COMPLIANCE_BLOCKED_COUNTRY_CODES')
        expect(log).not.toContain('CU,IR,KP,RU,UA')
    })

    it('propagates an operator edit from Gas Assist to Pistachio', async () => {
        const { left, right, logFile } = await fixture(
            'COMPLIANCE_FAIL_CLOSED=true\n',
            'COMPLIANCE_FAIL_CLOSED=false\n',
        )

        await run(left, right, logFile, ['--source', 'right'])

        expect(await readFile(left, 'utf8')).toContain('COMPLIANCE_FAIL_CLOSED=false')
        const log = await readFile(logFile, 'utf8')
        expect(log).toContain('COMPLIANCE_FAIL_CLOSED')
        expect(log).not.toContain('COMPLIANCE_FAIL_CLOSED=false')
    })

    it('allows an operator to opt an additional key into synchronization', async () => {
        const { left, right, leftDir, logFile } = await fixture(
            'SHARED_EXPERIMENT=enabled\n',
            'PORT=3002\n',
        )
        await writeFile(path.join(leftDir, 'shared-env-keys'), 'SHARED_EXPERIMENT\n')

        await run(left, right, logFile)

        expect(await readFile(right, 'utf8')).toContain('SHARED_EXPERIMENT=enabled')
    })
})
