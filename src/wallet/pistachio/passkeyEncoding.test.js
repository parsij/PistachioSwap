import { describe, expect, it } from 'vitest'

import { wipeBytes } from './passkeyEncoding.js'

describe('passkey byte cleanup', () => {
    it('overwrites an attached mutable buffer', () => {
        const bytes = new Uint8Array([1, 2, 3, 4])
        wipeBytes(bytes)
        expect([...bytes]).toEqual([0, 0, 0, 0])
    })

    it('does not reconstruct an ArrayBuffer after worker transfer detaches it', () => {
        const buffer = new Uint8Array(32).fill(7).buffer
        structuredClone(buffer, { transfer: [buffer] })
        expect(buffer.byteLength).toBe(0)
        expect(() => wipeBytes(buffer)).not.toThrow()
    })

    it('does not write through a typed-array view after its buffer is detached', () => {
        const bytes = new Uint8Array(32).fill(7)
        structuredClone(bytes.buffer, { transfer: [bytes.buffer] })
        expect(bytes.byteLength).toBe(0)
        expect(() => wipeBytes(bytes)).not.toThrow()
    })
})
