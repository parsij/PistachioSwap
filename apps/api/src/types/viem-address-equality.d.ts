import type { Address } from 'viem'
import 'viem'

declare module 'viem' {
    /**
     * Allows comparison with a string that has already passed the backend's
     * strict lowercase 0x-address normalization boundary.
     */
    export function isAddressEqual(
        firstAddress: Address,
        secondAddress: string,
    ): boolean
}
