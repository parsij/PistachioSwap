import { describe, expect, it, vi } from 'vitest'

import { CURATED_EVM_CHAINS } from './curatedEvmChains.js'
import { ensureWalletChain, waitForWalletChain } from './walletChain.js'

function fakeClock() {
    let value = 0
    return {
        now: () => value,
        sleep: async (delay) => {
            value += delay
        },
    }
}

describe('wallet chain readiness', () => {
    it('does not request a switch when Wagmi already reports the target chain', async () => {
        const switchNetwork = vi.fn()
        const account = await ensureWalletChain({
            config: {},
            targetChain: CURATED_EVM_CHAINS[0],
            switchNetwork,
            getAccountState: () => ({
                chainId: CURATED_EVM_CHAINS[0].id,
            }),
        })

        expect(account.chainId).toBe(CURATED_EVM_CHAINS[0].id)
        expect(switchNetwork).not.toHaveBeenCalled()
    })

    it('waits until Wagmi reports the switched chain instead of trusting the switch promise', async () => {
        const clock = fakeClock()
        let chainId = 56
        let switched = false
        let postSwitchReads = 0
        const targetChain = CURATED_EVM_CHAINS.find((chain) => chain.id === 8453)

        const account = await ensureWalletChain({
            config: {},
            targetChain,
            switchNetwork: async () => {
                switched = true
            },
            getAccountState: () => {
                if (switched) {
                    postSwitchReads += 1
                    if (postSwitchReads >= 2) chainId = targetChain.id
                }
                return { chainId }
            },
            now: clock.now,
            sleep: clock.sleep,
        })

        expect(postSwitchReads).toBeGreaterThanOrEqual(2)
        expect(account.chainId).toBe(8453)
    })

    it('accepts every curated send network after its live Wagmi state reaches the target', async () => {
        for (const targetChain of CURATED_EVM_CHAINS) {
            const clock = fakeClock()
            let chainId = targetChain.id === 56 ? 1 : 56
            let switched = false
            let postSwitchReads = 0
            const switchNetwork = vi.fn(async (chain) => {
                expect(chain.id).toBe(targetChain.id)
                switched = true
            })

            const account = await ensureWalletChain({
                config: {},
                targetChain,
                switchNetwork,
                getAccountState: () => {
                    if (switched) {
                        postSwitchReads += 1
                        if (postSwitchReads >= 2) chainId = targetChain.id
                    }
                    return { chainId }
                },
                now: clock.now,
                sleep: clock.sleep,
            })

            expect(switchNetwork).toHaveBeenCalledOnce()
            expect(account.chainId).toBe(targetChain.id)
        }
    })

    it('fails closed when the requested chain never becomes the active Wagmi chain', async () => {
        const clock = fakeClock()

        await expect(waitForWalletChain({
            config: {},
            targetChainId: 8453,
            timeoutMs: 300,
            pollMs: 100,
            getAccountState: () => ({ chainId: 56 }),
            now: clock.now,
            sleep: clock.sleep,
        })).rejects.toThrow('Wallet did not report the requested network in time.')
    })
})
