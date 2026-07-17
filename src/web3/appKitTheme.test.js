import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Reown theme configuration', () => {
    it('uses the Pistachio green accent without AppKit color mixing', () => {
        const source = readFileSync('src/web3/appKit.js', 'utf8')
        expect(source).toContain("'--apkt-accent': '#8ac27c'")
        expect(source).toContain("'--apkt-color-mix': '#191919'")
        expect(source).toContain("'--apkt-color-mix-strength': 0")
        expect(source).not.toContain("'#ff37c4'")
    })

    it('keeps one Reown/Wagmi provider stack and no competing wallet framework', () => {
        const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
        const dependencies = packageJson.dependencies
        expect(dependencies['@reown/appkit']).toBeTruthy()
        expect(dependencies.wagmi).toBeTruthy()
        expect(dependencies.thirdweb).toBeUndefined()
        expect(dependencies['@rainbow-me/rainbowkit']).toBeUndefined()

        const provider = readFileSync('src/web3/AppKitProvider.jsx', 'utf8')
        expect(provider.match(/<WagmiProvider/g)).toHaveLength(1)
    })

    it('coordinates the Pistachio connector with the existing AppKit instance', () => {
        const source = readFileSync('src/web3/appKit.js', 'utf8')
        expect(source).toContain('closeAppKit: () => appKit.close()')
        expect(source).toContain('clearAppKitLoading: () => appKit.setLoading(false)')
    })
})
