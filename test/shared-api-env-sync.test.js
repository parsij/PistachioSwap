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
    await writeFile(left, leftText)
    await writeFile(right, rightText)
    return { left, right, leftDir, rightDir }
}

async function run(left, right) {
    return execFileAsync(process.execPath, [script, '--required', '--left', left, '--right', right])
}

afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('shared API environment synchronizer', () => {
    it('copies missing shared settings both directions without copying service-only settings', async () => {
        const { left, right } = await fixture(
            'PORT=3006\nCOMPLIANCE_ENABLED=true\nOFAC_MAX_LIST_AGE_MS=86400000\n',
            'PORT=3002\nGAS_ASSIST_INTERNAL_TOKEN=shared-secret-token\n',
        )

        await run(left, right)

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

    it('fails closed on a shared-key conflict without printing secret values', async () => {
        const leftSecret = 'left-super-secret-value'
        const rightSecret = 'right-super-secret-value'
        const { left, right } = await fixture(
            `GAS_ASSIST_INTERNAL_TOKEN=${leftSecret}\n`,
            `GAS_ASSIST_INTERNAL_TOKEN=${rightSecret}\n`,
        )

        let failure
        try {
            await run(left, right)
        } catch (error) {
            failure = error
        }

        expect(failure).toBeTruthy()
        expect(failure.code).toBe(78)
        expect(failure.stderr).toContain('GAS_ASSIST_INTERNAL_TOKEN')
        expect(failure.stderr).not.toContain(leftSecret)
        expect(failure.stderr).not.toContain(rightSecret)
    })

    it('allows an operator to opt an additional key into synchronization', async () => {
        const { left, right, leftDir } = await fixture(
            'SHARED_EXPERIMENT=enabled\n',
            'PORT=3002\n',
        )
        await writeFile(path.join(leftDir, 'shared-env-keys'), 'SHARED_EXPERIMENT\n')

        await run(left, right)

        expect(await readFile(right, 'utf8')).toContain('SHARED_EXPERIMENT=enabled')
    })
})
