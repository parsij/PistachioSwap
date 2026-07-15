import {
    readFileSync,
    readdirSync,
    statSync,
} from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SECRET_NAMES = [
    'ALCHEMY_API_KEY',
    'ALCHEMY_BSC_RPC_URL',
    'BSC_RPC_URL',
    'UNISWAP_API_KEY',
    'ZEROX_API_KEY',
    'COINGECKO_DEMO_API_KEY',
]

function collectSourceFiles(directory) {
    return readdirSync(directory).flatMap((name) => {
        const path = join(directory, name)
        return statSync(path).isDirectory()
            ? collectSourceFiles(path)
            : ['.js', '.jsx'].includes(extname(path))
              ? [path]
              : []
    })
}

describe('frontend configuration boundaries', () => {
    it('does not reference backend secret names in frontend source', () => {
        const sourceDirectory = fileURLToPath(
            new URL('.', import.meta.url),
        )
        const source = collectSourceFiles(sourceDirectory)
            .filter((path) => !path.endsWith('security.test.js'))
            .map((path) => readFileSync(path, 'utf8'))
            .join('\n')

        for (const secretName of SECRET_NAMES) {
            expect(source).not.toContain(secretName)
        }
    })
})
