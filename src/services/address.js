export function shortenAddress(address, size = 4) {
    if (!address) return ''
    return `${address.slice(0, size + 2)}…${address.slice(-size)}`
}
