# Gas Assist multichain audit

Audit base: current remote main retrieved 2026-10-04. No network compatibility research was used.

The existing BNB design shares a chain-56 singleton across wallet authentication, sponsorship domains, UserOperation hashing, payment token queries, usage counters, order idempotency, funding and receipt RPCs. Cross-chain validation also assumes source 56. Browser authorization/signing and pending recovery have independent chain-56 constants. Generic UI copy says BNB even when the selected sell token is elsewhere.

## Changes and identity boundaries

- `bundler/chain-definitions.mjs` in Gas-Assist is the exact authoritative 13-chain matrix. The typed backend registry resolves addresses, RPCs, gas token, limits and flags from chain ID. Public capabilities include only browser-safe configuration.
- Immutable AsyncLocalStorage scopes carry the validated source chain through existing services. Stored order/challenge/session chain overrides request hints; disagreements are rejected. Concurrent source chains never mutate process environment.
- Sponsorship EIP-712 domains and ERC-4337 v0.8 UserOperation domains bind the actual chain. Browser authorization is chain-bound and never uses zero.
- Payment tokens, quotas, active orders, locks and idempotency are chain scoped. Migration retains BNB records and removes only the historical chain-56 CHECK constraints.
- RPC funding checks distinguish EntryPoint deposit from stake. Source RPC and private Bundler are selected independently for each chain. Recovery remains available when the chain's creation flag is disabled.
- Ordinary chain catalogs and token pricing are already multichain. BNB-specific PancakeSwap deployments and BNB settlement tokens stay BNB-specific; they are not copied onto another chain.
- The current direct architecture uses Simple7702Account.executeBatch for the reviewed five-call swap. Legacy atomic/cross-chain executors are not required for these UserOperations. Optional configured executors are verified if present.
- The order API receives unsigned operation fields only. Signed authorization/final UserOperation go from browser to the separate ingress and Alto. Backend receipt lookup cannot submit operations.

## Baseline validation

Before refactoring: 32 tests passed across Paymaster v0.8, receipt recovery, route binding, authentication domains and sponsorship policy.

## Original occurrence inventory

The following inventory includes generic assumptions requiring refactoring and intentionally BNB-specific provider, token catalog and deployment metadata. Numeric bit widths and digest slices are excluded.

```text
src/swapConfig.js:16: 56,
src/swapConfig.js:21: 'BNB Chain',
src/swapConfig.js:133: 56,
src/swapConfig.js:142: 'BNB',
src/swapConfig.js:146: 'BNB',
src/swapConfig.js:160: '/icons/BSC.svg',
src/services/balances.js:8: export const BSC_CHAIN_ID = 56
src/services/balances.js:15: * The previous 0.001 BNB reserve consumed nearly the entire balance of small
src/services/swapExecutionMode.js:9: 'Gas Assist will be used because the wallet does not have enough BNB for normal gas.'
src/services/swapExecutionMode.js:24: 'native-balance-loading': 'Checking native BNB balance…',
src/services/swapExecutionMode.js:25: 'native-balance-error': 'Native BNB balance could not be loaded.',
src/services/swapExecutionMode.js:26: 'gas-assist-config-loading': 'Not enough BNB for normal gas. Checking Gas Assist availability…',
src/services/swapExecutionMode.js:27: 'gas-assist-config-error': 'Not enough BNB for normal gas. Gas Assist availability could not be checked.',
src/services/swapExecutionMode.js:28: 'gas-assist-disabled': 'Not enough BNB for normal gas. Gas Assist is currently unavailable.',
src/services/swapExecutionMode.js:48: if (chainId !== 56) return { mode: null, reason: 'wrong-chain' }
src/services/swapExecutionMode.js:82: // Once a same-chain BSC wallet is below the normal gas reserve, never fall
src/services/swapAction.js:22: label: 'Switch to BNB Chain',
src/web3/appKitMetadata.js:20: description: 'Swap tokens on BNB Chain',
src/web3/walletRuntime.js:38: chainId: 56,
src/web3/appKit.js:68: defaultNetwork: getCuratedEvmChain(56),
src/web3/curatedEvmChains.js:29: export const DEFAULT_CHAIN_ID = 56
src/web3/curatedEvmChains.js:30: export const GAS_ASSIST_CHAIN_ID = 56
src/web3/curatedEvmChains.js:45: 56: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
src/web3/curatedEvmChains.js:185: if (Number(chainId) === 56) return BNB_CHAIN_LOGO_URI
src/web3/curatedEvmChains.js:211: gasAssist: Number(chainId) === GAS_ASSIST_CHAIN_ID,
src/web3/LiveWalletBindings.jsx:125: const chainId = wagmiAccount.chainId ?? wagmiChainId ?? network.chainId ?? 56
src/app/BrandMenu.jsx:40: description: 'Swap without holding BNB',
src/shared/components/AppIcons.jsx:25: d="M12 2C6.48 2 2 6.58 2 12.26c0 4.52 2.87 8.36 6.84 9.72.5.1.68-.22.68-.49 0-.24-.01-.88-.01-1.72-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.86.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05a9.2 9.2 0 0 1 5 0c1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.6.69.49A10.03 10.03 0 0 0 22 12.26C22 6.58 17.52 2 12 2Z"
src/features/tokens/services/marketTokens.js:411: chainId = 56,
src/features/tokens/services/walletTokens.js:279: chainId = 56,
src/features/tokens/model/tokenSearchQuery.js:19: 56: Object.freeze(['bnb', 'bsc', 'binance chain', 'binance smart chain']),
src/features/tokens/model/tokenSearchQuery.js:114: /* ETH and BNB are native symbols on multiple enabled networks. For a network
src/features/tokens/model/tokenSearchQuery.js:115: * qualifier, humans conventionally mean Ethereum and BNB Chain respectively.
src/features/tokens/model/tokenSearchQuery.js:118: EXACT_CHAIN_ALIASES.set('bnb', new Set([56]))
src/features/tokens/model/tokenSearchQuery.js:147: * acronyms such as OP, ARB, BSC, and AVAX are already covered above.
src/features/tokens/hooks/useWalletTokens.js:171: chainId = 56,
src/features/tokens/hooks/useTokenCatalog.js:188: chainId = 56,
src/features/tokens/hooks/useMarketTokens.js:45: chainId = 56,
src/features/tokens/components/tokenIconUtils.js:115: if (Number(token?.chainId) !== 56) return false
src/features/tokens/components/tokenIconUtils.js:127: // BNB has one canonical yellow mark throughout PistachioSwap.
src/features/wallet/services/walletHistoryClassifier.js:547: if (chainId !== 56 || normalizeAddress(value.from_address) !== wallet) return null
src/features/wallet/services/walletHistoryClassifier.js:599: if (chainId !== 56 || normalizeAddress(value.from_address) !== wallet) return null
src/features/wallet/services/walletHistoryClassifier.js:646: // exists on BNB Chain.
src/features/wallet/services/walletHistoryClassifier.js:681: if (chainId !== 56 || normalizeAddress(value.from_address) !== wallet) return null
src/features/wallet/services/walletHistoryClassifier.js:719: chainId !== 56 ||
src/features/wallet/services/walletHistory.js:28: 56: 'https://bnb-mainnet.g.alchemy.com/v2',
src/features/wallet/services/walletHistory.js:62: if (!configured) return [56]
src/features/wallet/services/walletHistory.js:68: return ids.length > 0 ? ids : [56]
src/features/wallet/services/walletHistory.js:96: const configured = Number(chainId) === 56
src/features/wallet/services/walletHistory.js:269: const internalStreams = Number(chainId) === 56
src/features/wallet/services/optimisticBalances.js:260: const configured = numericChainId === 56
src/features/wallet/hooks/useWalletActivity.js:23: import.meta.env.VITE_WALLET_HISTORY_CHAIN_IDS ?? '56',
src/features/wallet/hooks/useWalletActivity.js:29: return requested.length > 0 ? requested : [56]
src/features/wallet/hooks/useWalletState.js:9: export const BSC_CHAIN_ID = 56
src/features/wallet/components/wallet/ReceiveDialog.jsx:32: <span>BNB Smart Chain</span>
src/features/wallet/components/wallet/ReceiveDialog.jsx:55: Only send assets supported on BNB Smart Chain to this address.
src/features/wallet/components/wallet/WalletAssetList.jsx:163: : [...tokenChainIds][0] ?? 56
src/features/gas-assist/services/metamaskMultichain.js:13: export const METAMASK_BSC_SCOPE = 'eip155:56'
src/features/gas-assist/services/metamaskMultichain.js:73: * Validates the public BNB Chain RPC URL passed to the MetaMask SDK.
src/features/gas-assist/services/metamaskMultichain.js:84: 'A public BNB Chain RPC URL is required for MetaMask sponsored signing.',
src/features/gas-assist/services/metamaskMultichain.js:92: throw makeError('METAMASK_MULTICHAIN_PUBLIC_RPC_INVALID', 'The public BNB Chain RPC URL is invalid.')
src/features/gas-assist/services/metamaskMultichain.js:96: throw makeError('METAMASK_MULTICHAIN_PUBLIC_RPC_INVALID', 'The public BNB Chain RPC URL must use HTTPS.')
src/features/gas-assist/services/metamaskMultichain.js:214: * Connects the BNB Chain scope while coalescing concurrent connection attempts.
src/features/gas-assist/services/metamaskMultichain.js:234: /** @returns {Promise<void>} Resolves after disconnecting BNB scope and clearing session state. */
src/features/gas-assist/services/metamaskMultichain.js:251: /** @param {string} accountId CAIP-10 account identifier. @returns {string | null} Checksummed BNB address or null. */
src/features/gas-assist/services/metamaskMultichain.js:253: const match = /^eip155:56:(0x[0-9a-fA-F]{40})$/.exec(String(accountId ?? ''))
src/features/gas-assist/services/metamaskMultichain.js:410: if (chainId !== 56) throw makeError('WALLET_REWROTE_CHAIN_ID', 'The prepared transaction is not for BNB Chain.')
src/features/gas-assist/services/metamaskMultichain.js:422: chainId: '0x38',
src/features/gas-assist/services/metamaskMultichain.js:469: if (chainId !== 56) throw makeError('WALLET_REWROTE_CHAIN_ID', 'The prepared transaction is not for BNB Chain.')
src/features/gas-assist/services/metamaskMultichain.js:486: if (authorizationChainId !== 56) {
src/features/gas-assist/services/metamaskMultichain.js:487: throw makeError('WALLET_REWROTE_CHAIN_ID', 'The EIP-7702 authorization is not for BNB Chain.')
src/features/gas-assist/services/metamaskMultichain.js:494: chainId: '0x38',
src/features/gas-assist/services/metamaskMultichain.js:504: chainId: '0x38',
src/features/gas-assist/services/metamaskMultichain.js:536: if (parsed.chainId !== 56) mismatch('WALLET_REWROTE_CHAIN_ID', 'The wallet changed the transaction chain ID.')
src/features/gas-assist/services/metamaskMultichain.js:547: Number(signedAuth.chainId) !== 56 ||
src/features/gas-assist/services/metamaskMultichain.js:628: if (parsed.chainId !== 56) mismatch('WALLET_REWROTE_CHAIN_ID', 'The wallet changed the transaction chain ID.')
src/features/gas-assist/services/selfHostedPaymaster.js:22: const CHAIN_ID = 56
src/features/gas-assist/services/selfHostedPaymaster.js:148: deny('PAYMASTER_NATIVE_VALUE_FORBIDDEN', 'A sponsored five-call swap must not transfer native BNB.')
src/features/gas-assist/services/selfHostedPaymaster.js:280: * expected hash against its own signed intent and the final receipt on BSC.
src/features/gas-assist/services/selfHostedPaymaster.js:357: /** BSC has a zero base fee, so EntryPoint reimburses the priority fee.
src/features/gas-assist/services/selfHostedPaymaster.js:363: if (gasPrice === 0n) deny('PAYMASTER_FEE_INVALID', 'The BNB gas price is invalid.')
src/features/gas-assist/services/selfHostedPaymaster.js:464: deny('PAYMASTER_CHAIN_MISMATCH', 'The public RPC and bundler must both use BNB Chain 56.')
src/features/gas-assist/services/selfHostedPaymaster.js:571: orderId: prepared.orderId, userOpHash: expectedHash, chainId: 56,
src/features/gas-assist/services/selfHostedPaymaster.js:601: // Gas-Assist verifies the actual BNB Chain EntryPoint event and
src/features/gas-assist/services/selfHostedPaymaster.js:654: result.walletAddress?.toLowerCase() !== operation.walletAddress || result.chainId !== 56 ||
src/features/gas-assist/services/prepaidSponsorship.js:216: chainId: 56,
src/features/gas-assist/services/pendingUserOperations.js:8: value.chainId !== 56 || !Number.isFinite(value.timestamp)) return null
src/features/gas-assist/services/pendingUserOperations.js:11: walletAddress: value.walletAddress.toLowerCase(), chainId: 56,
src/features/gas-assist/hooks/usePrepaidSponsorship.js:144: const { data: walletClient } = useWalletClient({ chainId: 56 })
src/features/gas-assist/hooks/usePrepaidSponsorship.js:624: // A confirmed BSC source operation is not Polygon settlement.
src/features/gas-assist/hooks/usePrepaidSponsorship.js:627: const isCrossChain = Number(buyToken?.chainId ?? 56) !== 56
src/features/gas-assist/hooks/useGasAssistController.js:80: * @security Low-BNB execution is fail-closed into the exact self-hosted prepaid Gas Assist flow.
src/features/gas-assist/hooks/useGasAssistController.js:117: chainId: 56,
src/features/gas-assist/hooks/useGasAssistController.js:123: chainId: 56,
src/features/gas-assist/hooks/useGasAssistController.js:137: chainId: 56,
src/features/gas-assist/hooks/useGasAssistController.js:158: chainId: 56,
src/features/gas-assist/hooks/useGasAssistController.js:229: chainId: 56,
src/features/gas-assist/hooks/useGasAssistController.js:271: chainId: 56,
src/features/gas-assist/hooks/useSponsorshipConfig.js:26: * Loads the backend-authoritative prepaid sponsorship configuration for low-BNB routing.
src/features/gas-assist/hooks/useSponsorshipPreview.js:10: * Debounces the non-mutating prepaid preview for low-BNB same-chain swaps.
src/features/gas-assist/components/GasAssistPrepaymentDialog.jsx:144: return { title: 'Confirming your swap', detail: 'Waiting for the sponsored transaction to confirm on BNB Chain.' }
src/features/gas-assist/components/GasAssistPrepaymentDialog.jsx:148: return { title: 'Starting your swap', detail: 'Confirming the Gas Assist fee on BNB Chain.' }
src/features/gas-assist/components/GasAssistPrepaymentDialog.jsx:249: Pistachio Wallet signs one direct EIP-7702 BNB Chain transaction. The disclosed fee goes to PistachioSwap, the swap principal goes directly through the quoted router, and everything reverts if the swap fails.
src/features/gas-assist/components/GasAssistPrepaymentDialog.jsx:347: <div className="gas-assist-kicker"><ShieldCheck aria-hidden="true" /> No BNB needed</div>
src/features/gas-assist/components/GasAssistPrepaymentDialog.jsx:350: ? 'PistachioSwap sponsors the exact BNB Chain source operation through its self-hosted Paymaster and deducts one clear fee from your sell token. No BNB is sent to your wallet.'
src/features/gas-assist/components/GasAssistBanner.jsx:3: * Explains why a low-BNB same-chain swap is routed through prepaid Gas Assist.
src/features/gas-assist/components/GasAssistBanner.jsx:17: <strong>{pair} needs Gas Assist because this wallet does not have enough BNB for normal network gas.</strong>
src/features/gas-assist/components/GasAssistBanner.jsx:19: PistachioSwap can sponsor one BNB Chain transaction for the disclosed fee, exact approval, and swap instead of sending a normal transaction that the wallet cannot pay for.
src/features/swap/model/swapEligibility.js:46: Number(sellChainId) === 56 &&
src/features/swap/model/swapEligibility.js:60: Number(sellChainId) !== 56 ||
src/features/swap/model/swapEligibility.js:86: Number(sellChainId) !== 56 ||
src/features/swap/hooks/useSwapRouting.js:27: * @sideEffects Loads prepaid sponsorship configuration only for the eligible BSC state.
src/features/swap/hooks/useSwapRouting.js:33: const isBscSwap = sellChainId === 56 && buyChainId === 56
src/features/swap/hooks/useSwapRouting.js:34: const isBscSource = sellChainId === 56
src/features/swap/hooks/useSwapRouting.js:38: walletState.address && walletState.chainId === 56),
src/features/swap/hooks/useSwapPrimaryAction.js:155: setVisibleStatus('Prepaid Gas Assist is unavailable. Normal approval is blocked because this wallet does not have enough BNB for gas.')
src/features/swap/components/SwapCard.jsx:11: * Gas Assist's low-BNB disclosure is kept inline beside the execution status.
src/features/swap/components/TransactionStatus.jsx:7: "Every blockchain transaction needs gas, paid with that network's native token. On BNB Chain, gas is paid in BNB. Because this wallet is short on BNB, PistachioSwap can sponsor it; the exact Gas Assist fee is shown before you confirm."
src/features/swap/components/TransactionStatus.jsx:52: ariaLabel="Why Gas Assist needs BNB"
src/features/cross-chain/hooks/useCrossChainGasAssist.js:33: * Sponsors the exact BNB Chain source transaction through the direct atomic
src/features/cross-chain/hooks/useCrossChainGasAssist.js:89: Number(sellToken?.chainId) === 56 &&
src/features/cross-chain/hooks/useCrossChainGasAssist.js:95: Number(sellToken?.chainId) === 56 &&
src/features/cross-chain/hooks/useCrossChainGasAssist.js:118: const sourceChainId = Number(preparedRoute.sourceChainId ?? sellToken?.chainId ?? 56)
src/features/cross-chain/hooks/useCrossChainGasAssist.js:133: // the Polygon leg. Never add it optimistically on BSC source inclusion.
src/features/cross-chain/hooks/useCrossChainGasAssist.js:171: chainId: Number(preparedRoute?.sourceChainId ?? sellToken?.chainId ?? 56),
src/features/cross-chain/hooks/useCrossChainGasAssist.js:239: chainId: Number(preparedRoute?.sourceChainId ?? sellToken?.chainId ?? 56),
src/features/cross-chain/components/CrossChainReviewDialog.jsx:140: {gasAssistState.required && ' Gas Assist can sponsor this exact source transaction without adding BNB to your wallet.'}
src/features/cross-chain/components/CrossChainReviewDialog.jsx:145: Your BNB balance covers the current estimate, but it is below the recommended gas reserve. Use Gas Assist with its fee included in the quote, or try a normal swap and let your wallet verify the final network fee.
src/features/passkey/services/walletManagerProduction.js:154: : 'Chain ID: 56'
src/features/passkey/services/walletManagerProduction.js:158: (sponsorship && expectedChain !== 56)
src/features/passkey/services/walletManagerSession.js:68: if (chainId === 56) return import.meta.env.VITE_BSC_PUBLIC_RPC_URL
src/features/passkey/services/walletManagerAlchemySigning.js:36: if (chainId !== 56 || !Number.isSafeInteger(nonce) || nonce < 0) {
src/features/passkey/services/walletManagerAlchemySigning.js:37: throw alchemySigningError('ALCHEMY_AUTHORIZATION_INVALID', 'Alchemy returned invalid BNB Chain authorization parameters.')
src/features/passkey/services/walletManagerAlchemySigning.js:58: const context = this.captureSigningContext(56)
src/features/passkey/services/walletManagerAlchemySigning.js:61: chainId: 56,
src/features/passkey/services/walletManagerAlchemySigning.js:64: purpose: 'Authorize the reviewed Alchemy smart-account implementation for BNB Chain Gas Assist. This does not reveal your private key or transfer tokens by itself.',
src/features/passkey/services/walletManagerAlchemySigning.js:80: chainId: 56,
src/features/passkey/services/walletManagerAlchemySigning.js:91: chainId: 56,
src/features/passkey/services/walletManagerAlchemySigning.js:104: Number(signed.chainId) !== 56 ||
src/features/passkey/services/constants.js:3: export const PISTACHIO_CHAIN_ID = 56
src/features/passkey/services/constants.js:4: export const PISTACHIO_CHAIN_HEX = '0x38'
src/features/passkey/services/constants.js:5: export const PISTACHIO_CAIP_CHAIN_ID = 'eip155:56'
src/features/passkey/services/walletManagerCore.js:67: if (chainId === 56) return import.meta.env.VITE_BSC_PUBLIC_RPC_URL
src/features/passkey/services/walletWorker.js:143: throw new TypeError('Gas Assist EIP-7702 authorization is BNB Chain-only.')
src/features/passkey/services/walletWorker.js:203: throw new TypeError('Gas Assist authorization must be scoped to BNB Chain.')
src/features/passkey/services/walletManagerSigning.js:238: if (chainId === 56) return import.meta.env.VITE_BSC_PUBLIC_RPC_URL
src/features/passkey/services/walletManagerSelfHostedPaymasterSigning.js:5: const CHAIN_ID = 56
src/features/passkey/services/walletManagerSelfHostedPaymasterSigning.js:42: deny('PAYMASTER_AUTHORIZATION_INVALID', 'The EIP-7702 authorization differs from the BNB Chain trusted delegation.')
src/features/passkey/services/walletManagerSelfHostedPaymasterSigning.js:71: : 'Delegate this existing EOA to the trusted ERC-4337 Simple7702Account for BNB Chain. This authorization does not itself transfer tokens.',
src/features/passkey/services/walletManagerSelfHostedPaymasterSigning.js:74: authorizationScope: 'BNB Chain (56)',
src/features/passkey/services/walletManagerLifecycle.js:68: if (chainId === 56) return import.meta.env.VITE_BSC_PUBLIC_RPC_URL
src/features/passkey/services/walletManagerSetup.js:68: if (chainId === 56) return import.meta.env.VITE_BSC_PUBLIC_RPC_URL
src/features/passkey/components/wallet/WalletSigningReview.jsx:186: {payload.authorization && <div className="pistachio-wallet-info"><ShieldCheck aria-hidden="true" /><p>Explorers show this as To: Self because the transaction is sent to your own wallet. For this swap it temporarily runs the Gas Assist executor in your account. BNB gas is sponsored. The Gas Assist fee is already in the quote and is taken only if this swap succeeds.</p></div>}
apps/api/src/chains.ts:83: gasAssist: chain.id === 56,
apps/api/src/config.ts:110: const explicit = process.env.ALCHEMY_BSC_RPC_URL?.trim()
apps/api/src/config.ts:114: 'ALCHEMY_BSC_RPC_URL',
apps/api/src/config.ts:176: chainId: 56,
apps/api/src/config.ts:464: process.env.PANCAKESWAP_WRAPPED_NATIVE_ADDRESS_56,
apps/api/src/config.ts:519: process.env.PANCAKESWAP_ROUTER_ADDRESS_56,
apps/api/src/config.ts:522: process.env.PANCAKESWAP_PERMIT2_ADDRESS_56 ??
apps/api/src/config.ts:526: process.env.PANCAKESWAP_QUOTER_ADDRESS_56,
apps/api/src/config.ts:529: process.env.PANCAKESWAP_WRAPPED_NATIVE_ADDRESS_56,
apps/api/src/config.ts:531: rpcUrl: readRpcUrl('BSC_RPC_URL') || getAlchemyRpcUrl(),
apps/api/src/config.ts:533: process.env.FEE_EXECUTOR_ADDRESS_56,
apps/api/src/config.ts:690: 'executor-contract fee mode requires FEE_EXECUTOR_ADDRESS_56.',
apps/api/src/modules/market-tokens-base.ts:365: token.chainId === 56 &&
apps/api/src/modules/market-tokens-base.ts:1435: if (chainId !== 56) return
apps/api/src/modules/market-tokens-base.ts:1912: chainId = 56,
apps/api/src/modules/market-tokens-base.ts:2007: if (!catalog.partial && chainId === 56) {
apps/api/src/modules/market-tokens-base.ts:2039: chainId = 56,
apps/api/src/modules/market-tokens-base.ts:2189: async function getSearch(query: string, chainId = 56) {
apps/api/src/modules/gas-assist-proxy.ts:143: return { enabled: false, chainId: 56 }
apps/api/src/modules/uniswap-volume-tokens.ts:85: 56: [{
apps/api/src/modules/uniswap-volume-tokens.ts:89: evidence: 'The Graph Explorer lists Uniswap V3 BSC on network bsc with 100% indexing.',
apps/api/src/modules/uniswap-volume-tokens.ts:619: chainId: 56,
apps/api/src/modules/uniswap-volume-tokens.ts:621: subgraphId: VERIFIED_SUBGRAPHS[56]?.[0]?.subgraphId ?? null,
apps/api/src/modules/wallet-activity.ts:63: // Pistachio-owned BNB Chain contracts that have been used by the product.
apps/api/src/modules/wallet-activity.ts:421: if (chainId !== 56) return null
apps/api/src/modules/wallet-activity.ts:553: if (chainId !== 56 || normalizeAddress(value.from_address) !== wallet) return null
apps/api/src/modules/wallet-activity.ts:833: if (chainId !== 56) throw new Error('History provider unavailable')
apps/api/src/modules/wallet-activity.ts:1023: if (chainIds.length === 0) chainIds.push(56)
apps/api/src/lib/native-token.ts:6: id: createTokenId(56, NATIVE_TOKEN_ADDRESS),
apps/api/src/lib/native-token.ts:7: chainId: 56 as const,
apps/api/src/lib/native-token.ts:9: name: 'BNB',
apps/api/src/lib/native-token.ts:10: symbol: 'BNB',
apps/api/src/providers/token-decimals.ts:31: chainId = 56,
apps/api/src/providers/token-logos.ts:24: 1: 'ethereum', 10: 'optimism', 25: 'cronos', 56: 'smartchain',
apps/api/src/providers/token-logos.ts:131: url: getTrustWalletLogoUrl(chainId ?? 56, address),
apps/api/src/providers/token-logos.ts:135: url: getTrustedExactAssetImage(chainId ?? 56, address),
apps/api/src/cross-chain/service.ts:158: if (!route || route.ownerAddress !== owner || route.sourceAsset.chainId !== 56 || route.destinationAsset.chainId === 56) throw routeError('ROUTE_NOT_FOUND', 'Route was not found.')
apps/api/src/cross-chain/service.ts:243: if (originalRoute.sourceAsset.chainId !== 56 ||
apps/api/src/cross-chain/service.ts:244: originalRoute.destinationAsset.chainId === 56 ||
apps/api/src/cross-chain/service.ts:250: 'Gas Assist only supports exact BEP-20 source transactions from BNB Chain.',
apps/api/src/cross-chain/service.ts:437: if (!transaction || transaction.chainId !== 56 ||
apps/api/src/token-discovery/context.ts:41: if (chainId === 56 && config.rpcUrl) return new URL(config.rpcUrl)
apps/api/src/token-discovery/registry.ts:66: 1: 'ethereum.svg', 56: 'bsc.webp', 137: 'polygon.webp', 42161: 'arbitrum.webp',
apps/api/src/token-discovery/registry.ts:80: { chainId: 56, name: 'BNB Chain', active: true, native: { name: 'BNB', symbol: 'BNB', coinGeckoId: 'binancecoin' }, wrappedNative: { address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', name: 'Wrapped BNB', symbol: 'WBNB' }, providers: { geckoTerminalNetwork: 'bsc', coinGeckoNetwork: 'bsc', dexScreenerChain: 'bsc', moralisChain: 'bsc', alchemyNetwork: 'bnb-mainnet', rpcEnv: 'BSC_RPC_URL', goPlusChainId: '56' }, capabilities: { curatedLists: true } },
apps/api/src/token-discovery/registry.ts:102: { chainId: 204, name: 'opBNB', active: true, native: { name: 'BNB', symbol: 'BNB', coinGeckoId: 'binancecoin' }, wrappedNative: { address: '0x4200000000000000000000000000000000000006', name: 'Wrapped BNB', symbol: 'WBNB' }, providers: { geckoTerminalNetwork: 'opbnb', coinGeckoNetwork: 'opbnb', dexScreenerChain: 'opbnb', moralisChain: null, alchemyNetwork: 'opbnb-mainnet', rpcEnv: 'OPBNB_RPC_URL', goPlusChainId: '204' } },
apps/api/src/token-discovery/registry.ts:109: 1, 10, 25, 56, 100, 130, 137, 146, 204, 324, 480, 1088, 1284,
apps/api/src/token-discovery/registry.ts:114: 1, 10, 25, 56, 100, 130, 137, 146, 204, 324, 480, 1088, 1284,
apps/api/src/token-discovery/registry.ts:119: 1, 10, 25, 56, 100, 130, 137, 146, 204, 324, 480, 1088, 1284,
apps/api/src/token-discovery/registry.ts:142: 56: { coinstack: 'bnbsmartchain', localPort: 3156 },
apps/api/src/token-discovery/registry.ts:168: honeypot: [1, 56, 8453].includes(entry.chainId),
apps/api/src/token-discovery/token-catalog-overrides.ts:15: const BNB_CHAIN_ID = 56
apps/api/src/token-discovery/token-catalog-overrides.ts:21: searchAliases: Object.freeze(['USDT', 'Tether USD', 'BSC-USD']),
apps/api/src/providers/dexpaprika/networks.ts:5: 56: 'bsc',
apps/api/src/providers/recognition/curated-token-lists.ts:73: chainId: 56,
apps/api/src/providers/recognition/curated-token-lists.ts:119: OFFICIAL_ASSETS.filter((asset) => asset.chainId === 56)
apps/api/src/providers/recognition/curated-token-lists.ts:164: if (value.chainId !== undefined && Number(value.chainId) !== 56) continue
apps/api/src/providers/recognition/curated-token-lists.ts:170: officialAsset: getOfficialAsset(56, address),
apps/api/src/providers/recognition/curated-token-lists.ts:214: const officialAsset = getOfficialAsset(56, address)
apps/api/src/providers/security/token-security.ts:270: async function refresh(addressValue: string, signal?: AbortSignal, chainId = 56) {
apps/api/src/providers/security/token-security.ts:328: function peekCached(addressValue: string, chainId = 56) {
apps/api/src/providers/security/token-security.ts:339: function getCachedAndRefresh(addressValue: string, chainId = 56) {
apps/api/src/providers/security/token-security.ts:343: function refreshIfStale(addressValue: string, chainId = 56) {
apps/api/src/providers/security/goplus-client.ts:17: chainId = 56,
apps/api/src/providers/security/goplus-token-security.ts:38: chainId = 56,
apps/api/src/providers/security/goplus-token-security.ts:56: chainId = 56,
apps/api/src/providers/security/goplus-token-security.ts:85: chainId = 56,
apps/api/src/providers/security/goplus-token-security.ts:115: chainId = 56,
apps/api/src/providers/security/honeypot-token-security.ts:73: chainId = 56,
apps/api/src/providers/security/honeypot-token-security.ts:90: chainId = 56,
apps/api/src/providers/security/honeypot-token-security.ts:140: chainId = 56,
apps/api/src/providers/moralis/moralis-client.ts:9: chainId = 56,
apps/api/src/providers/moralis/wallet-token-spam.ts:64: chainId: 56,
apps/api/src/providers/moralis/wallet-token-spam.ts:100: chainId = 56,
apps/api/src/providers/moralis/types.ts:2: chainId: 56
apps/api/src/providers/moralis/sponsorship-token-evidence.ts:122: chainId = 56,
apps/api/src/providers/coingecko/token-search.ts:67: chainId = 56,
apps/api/src/providers/coingecko/token-data.ts:110: chainId = 56,
apps/api/src/providers/coingecko/token-data.ts:156: chainId = 56,
apps/api/src/providers/geckoterminal/top-pools.ts:171: chainId = 56,
apps/api/src/providers/dexscreener/token-search.ts:62: chainId = 56,
apps/api/src/providers/dexscreener/token-markets.ts:153: chainId = 56,
apps/api/src/providers/alchemy/wallet-tokens-base.ts:668: if (chainId === 56) {
apps/api/src/providers/alchemy/wallet-tokens-base.ts:746: chainId = 56,
apps/api/src/providers/alchemy/wallet-tokens-base.ts:914: chainId === 56
apps/api/src/providers/alchemy/wallet-history.ts:137: // BNB's transfer index does not cover internal-only native receipts.
apps/api/src/providers/alchemy/token-prices.ts:307: chainId = 56,
apps/api/src/providers/alchemy/token-prices.ts:404: export async function getNativeTokenPrice(chainId = 56, signal?: AbortSignal) {
apps/api/src/providers/alchemy/token-prices.ts:501: export function getNativeBnbPrice(signal?: AbortSignal, chainId = 56) {
apps/api/src/providers/alchemy/alchemy-client.ts:61: chainId = 56,
apps/api/src/providers/alchemy/alchemy-client.ts:89: chainId = 56,
apps/api/src/providers/alchemy/portfolio-networks.ts:3: [56, 'bnb-mainnet'],
apps/api/src/cross-chain/adapters/across/index.ts:26: 56: [
apps/api/src/cross-chain/adapters/across/index.ts:134: // BSC self-hosted sponsorship must use independently
apps/api/src/cross-chain/adapters/debridge/index.ts:26: 56: '0xef4fb24ad0916217251f553c0596f8edc630eb66',
apps/api/src/cross-chain/adapters/zero-x/index.ts:26: 56: '0x0000000000001ff3684f28c67538d4d072c22734',
apps/api/src/cross-chain/adapters/zero-x/index.ts:113: throw new Error('0x returned an unverified BSC AllowanceHolder target.')
apps/api/src/features/quotes/providers/zero-x-provider.ts:19: 1, 10, 56, 130, 137, 146, 480, 8453, 34443, 42161, 43114,
apps/api/src/features/quotes/providers/zero-x-provider.ts:241: url.searchParams.set('chainId', '56')
apps/api/src/features/quotes/providers/kyberswap-provider.ts:25: [56, 'bsc'],
scripts/live-gas-assist-e2e.mjs:32: * Default live direction: 0.15 USDC -> USDT on BNB Chain, using the
scripts/live-gas-assist-e2e.mjs:33: * disposable zero-BNB test wallet.
scripts/live-gas-assist-e2e.mjs:36: * unless the operator explicitly confirms BNB mainnet. It never prints the
scripts/live-gas-assist-e2e.mjs:40: const CHAIN_ID = 56
scripts/live-gas-assist-e2e.mjs:319: `Public RPC is on chain ${chainId}, expected 56.`,
scripts/live-gas-assist-e2e.mjs:326: 'Bundler is not on BNB Chain 56.',
scripts/live-gas-assist-e2e.mjs:399: `Test wallet must start with exactly 0 BNB; found ${formatEther(before.bnb)} BNB.`,
scripts/live-gas-assist-e2e.mjs:1159: `Test wallet unexpectedly holds ${formatEther(after.bnb)} BNB after sponsored execution.`,
scripts/diagnose-wallet-activity.mjs:15: const chainId = Number(positionals[1] ?? 56)
scripts/diagnose-wallet-activity.mjs:16: if (!/^0x[0-9a-f]{40}$/.test(wallet) || chainId !== 56) {
scripts/diagnose-wallet-activity.mjs:17: throw new Error('Supply a wallet address and chain ID 56.')
scripts/diagnose-wallet-activity.mjs:19: const rpcUrl = process.env.ACTIVITY_DIAGNOSTIC_RPC_URL ?? process.env.BSC_RPC_URL ?? process.env.ALCHEMY_BSC_RPC_URL
scripts/local/pchained-registry.mjs:10: { name: 'bnbsmartchain', runtime: 'node', port: 3156, chainId: 56 },
scripts/unchained-local/bnb-smoke.mjs:45: console.error(`BNB account smoke failed: ${code === 'ECONNREFUSED' ? 'connection-refused' : 'request-failed'}`)
scripts/unchained-local/bnb-smoke.mjs:49: console.error(`BNB account smoke failed: HTTP ${response.status}`)
scripts/unchained-local/bnb-smoke.mjs:55: console.error(`BNB account smoke failed schema field: ${result.field}`)
scripts/unchained-local/bnb-smoke.mjs:58: console.log(`BNB account smoke passed: HTTP 200, nativePositive=${result.nativePositive}, erc20Positive=${result.erc20Positive}, erc20Total=${result.erc20Total}, addressMatched=true`)
scripts/unchained-local/prepare-bnb.mjs:73: const rpcFromBsc = splitRpcUrl(env.BSC_RPC_URL ?? '')
scripts/unchained-local/prepare-bnb.mjs:95: console.error(`Missing BNB Pchained configuration: ${missing.join(', ')}`)
scripts/unchained-local/prepare-bnb.mjs:112: console.log(`Prepared Pchained ${upstreamCommit} for BNB Smart Chain.`)
scripts/unchained-local/config.mjs:2: { chainId: 56, chain: 'BNB Chain', coinstack: 'bnbsmartchain', port: 3156, supported: true },
scripts/unchained-local/bnb-up.mjs:18: console.log('BNB Unchained API is healthy at http://127.0.0.1:3156')
scripts/unchained-local/bnb-up.mjs:24: console.error('BNB Unchained API did not become healthy before timeout.')
scripts/deploy/activate-vps-release.sh:98: BSC_RPC_URL=https://bsc-dataseed.bnbchain.org
scripts/deploy/activate-vps-release.sh:405: "http://127.0.0.1:${API_PORT}/api/v1/token-catalog?chainId=56&mode=all&limit=1"
scripts/deploy/activate-vps-release.sh:411: if (health.status !== 'ok' || health.chainId !== 56) process.exit(1)
scripts/deploy/activate-vps-release.sh:469: "$PUBLIC_ORIGIN/api/v1/token-catalog?chainId=56&mode=all&limit=1"
scripts/deploy/activate-vps-release.sh:475: if (health.status !== 'ok' || health.chainId !== 56) process.exit(1)
```
