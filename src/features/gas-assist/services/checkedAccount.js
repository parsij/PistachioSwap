import { CHECKED_ACCOUNT_RUNTIME_HASH } from './checkedAccountIdentity.js'
import { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, toHex, getAddress } from 'viem'
const abi = parseAbi([
    'function executionVersion() view returns (bytes32)',
    'function ENTRY_POINT() view returns (address)',
    'function TRUSTED_DELEGATE() view returns (address)',
])
export async function verifyCheckedAccountDeployment(settings, rpc) {
    const call = async (to, functionName) => decodeFunctionResult({ abi, functionName,
        data: await rpc('eth_call', [{ to, data: encodeFunctionData({ abi, functionName }) }, 'latest']) })
    const [entryPointCode, delegateCode, paymasterCode, version, entryPoint, delegate] = await Promise.all([
        rpc('eth_getCode', [settings.entryPoint, 'latest']),
        rpc('eth_getCode', [settings.delegate, 'latest']), rpc('eth_getCode', [settings.paymaster, 'latest']),
        call(settings.delegate, 'executionVersion'), call(settings.paymaster, 'ENTRY_POINT'), call(settings.paymaster, 'TRUSTED_DELEGATE'),
    ])
    if (keccak256(delegateCode) !== CHECKED_ACCOUNT_RUNTIME_HASH || entryPointCode === '0x' || keccak256(entryPointCode).toLowerCase() !== settings.checkedExecution.entryPointCodeHash.toLowerCase() || delegateCode === '0x' || paymasterCode === '0x' ||
        keccak256(delegateCode).toLowerCase() !== settings.checkedExecution.delegateCodeHash.toLowerCase() ||
        keccak256(paymasterCode).toLowerCase() !== settings.checkedExecution.paymasterCodeHash.toLowerCase() ||
        version !== keccak256(toHex('pistachio-checked-7702-v1')) ||
        getAddress(entryPoint) !== settings.entryPoint || getAddress(delegate) !== settings.delegate) {
        throw Object.assign(new Error('The checked account or Paymaster deployment changed.'), { code: 'PAYMASTER_CHECKED_DEPLOYMENT_INVALID' })
    }
}
