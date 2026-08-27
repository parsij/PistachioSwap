import { existsSync } from 'node:fs'
import path from 'node:path'

import { PCHAINED_CHAINS, chainPaths } from './pchained-registry.mjs'
import { requireCommand, resolveSibling, run, verifyRepository } from './utils.mjs'

const root = process.cwd()
requireCommand('git')
requireCommand('gh', 'Install and authenticate GitHub CLI')
run('gh', ['auth', 'status'], { stdio: 'inherit' })

const pchainedDir = resolveSibling(root, process.env.PCHAINED_LOCAL_DIR, ['../Pchained'])

if (!existsSync(pchainedDir)) {
    run('gh', ['repo', 'clone', 'parsij/Pchained', pchainedDir])
}

verifyRepository(pchainedDir, 'parsij/Pchained')

const missingEnv = []
if (!existsSync(path.join(root, 'apps', 'api', '.env'))) missingEnv.push(path.join(root, 'apps', 'api', '.env'))

const configuredChains = []
for (const chain of PCHAINED_CHAINS) {
    const paths = chainPaths(pchainedDir, chain)
    if (existsSync(paths.envPath)) configuredChains.push(chain.name)
}

console.log(`Pchained checkout: ${pchainedDir}`)
console.log(
    configuredChains.length > 0
        ? `Configured Pchained coinstacks: ${configuredChains.join(', ')}`
        : 'Configured Pchained coinstacks: none',
)

if (missingEnv.length > 0) {
    console.error('Create the following environment files before running pnpm dev --local:')
    for (const file of missingEnv) console.error(`  ${file}`)
    process.exitCode = 1
}
