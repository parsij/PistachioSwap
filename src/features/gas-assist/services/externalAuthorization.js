import { getAddress, numberToHex, serializeSignature } from 'viem'

function deny(code, message) {
    throw Object.assign(new Error(message), { code })
}

// Nonstandard, explicitly implemented by external providers such as
// dogeshitmeme/dogeshit-wallet@8131fa08. This is NOT viem's local-account
// signAuthorization action, personal_sign, or an eth_sign fallback.
export async function assertExternalWalletContext(walletClient, sender, chainId) {
    const [chain, accounts] = await Promise.all([
        walletClient.request({ method: 'eth_chainId' }),
        walletClient.request({ method: 'eth_accounts' }),
    ])
    if (!/^0x[0-9a-f]+$/iu.test(String(chain)) || BigInt(chain) !== BigInt(chainId)) {
        deny('PAYMASTER_CHAIN_MISMATCH', 'Switch your external wallet to the quoted source network.')
    }
    if (!Array.isArray(accounts) || !accounts.length ||
        getAddress(accounts[0]) !== getAddress(sender)) {
        deny('PISTACHIO_ACCOUNT_MISMATCH', 'The selected external wallet account changed. Start again.')
    }
}

export async function signExternalAuthorization(walletClient, sender, { chainId, address, nonce }) {
    await assertExternalWalletContext(walletClient, sender, chainId)
    let result
    try {
        result = await walletClient.request({
            method: 'wallet_signAuthorization',
            params: [{ address, chainId: numberToHex(chainId), nonce: numberToHex(nonce) }],
        })
    } catch (error) {
        const code = Number(error?.code ?? error?.cause?.code)
        if ([-32601, 4200, 4100].includes(code)) {
            deny('EXTERNAL_AUTHORIZATION_UNSUPPORTED', 'This wallet does not provide the EIP-7702 authorization signing required by Gas Assist. Use Pistachio Wallet or a compatible external signer.')
        }
        throw error
    }
    // The provider returns a signed tuple, not a signature string. Reject any
    // changed field before converting it; caller additionally recovers the EOA
    // signer and rechecks the live delegation and authorization nonce.
    try {
        if (!result || typeof result !== 'object' ||
            getAddress(result.address) !== getAddress(address) ||
            BigInt(result.chainId) !== BigInt(chainId) ||
            BigInt(result.nonce) !== BigInt(nonce) ||
            ![0n, 1n].includes(BigInt(result.yParity)) ||
            !/^0x[0-9a-f]{64}$/iu.test(result.r) ||
            !/^0x[0-9a-f]{64}$/iu.test(result.s)) throw new Error('Invalid tuple')
        await assertExternalWalletContext(walletClient, sender, chainId)
        return serializeSignature({ r: result.r, s: result.s, yParity: Number(result.yParity) })
    } catch (error) {
        if (error?.code) throw error
        deny('PAYMASTER_AUTHORIZATION_INVALID', 'The external wallet returned an invalid or modified EIP-7702 authorization.')
    }
}
