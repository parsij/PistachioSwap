from pathlib import Path
import re


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


# Reuse the production swap TokenSelector in wallet-only mode.
path = Path("src/features/tokens/components/TokenSelector.jsx")
text = path.read_text()
text = replace_once(
    text,
    " * @param {'sell'|'buy'} props.side Side whose token is being selected; used only for the dialog label.\n",
    " * @param {'sell'|'buy'|'send'} props.side Side whose token is being selected; used only for the dialog label.\n"
    " * @param {boolean} [props.walletOnly] Restricts the selector to wallet-owned holdings while preserving the exact selector UI.\n",
    "TokenSelector docs",
)
text = replace_once(
    text,
    "    onChainChange = null,\n}) {",
    "    onChainChange = null,\n    walletOnly = false,\n}) {",
    "TokenSelector prop",
)
text = replace_once(
    text,
    "        if (state.normalizedSearch || chainId === 'all') return\n",
    "        if (walletOnly || state.normalizedSearch || chainId === 'all') return\n",
    "TokenSelector scroll guard",
)
text = replace_once(
    text,
    "<Sections state={state} loading={loading} currentToken={currentToken} oppositeToken={oppositeToken} hideUnknownTokens={hideUnknownTokens} />",
    "<Sections state={state} loading={loading} currentToken={currentToken} oppositeToken={oppositeToken} hideUnknownTokens={hideUnknownTokens} walletOnly={walletOnly} />",
    "TokenSelector sections",
)
path.write_text(text)

path = Path("src/features/tokens/components/TokenSelectorSections.jsx")
text = path.read_text()
text = replace_once(
    text,
    "export function TokenSelectorSections({ state, loading, currentToken, oppositeToken, hideUnknownTokens }) {\n",
    "export function TokenSelectorSections({ state, loading, currentToken, oppositeToken, hideUnknownTokens, walletOnly = false }) {\n",
    "TokenSelectorSections prop",
)
text = replace_once(
    text,
    "    const marketUnavailable = state.sortedGlobalMarketTokens.length === 0 && !loading\n",
    "    const marketUnavailable = !walletOnly && state.sortedGlobalMarketTokens.length === 0 && !loading\n",
    "market unavailable guard",
)
text = replace_once(
    text,
    '''        {state.visibleRecentTokens.length > 0 && <section className="ps-token-section"><SectionTitle icon={<ClockIcon />} action={<button type="button" className="ps-token-section-action" onClick={state.clearRecentTokens}>Clear</button>}>Recent searches</SectionTitle>{state.visibleRecentTokens.map((token) => row(token, hasPositiveBalance(token)))}</section>}
        {(state.sortedGlobalMarketTokens.length > 0 || loading) && <section className="ps-token-section"><SectionTitle icon={<TrendingIcon />}>Tokens</SectionTitle>{loading && state.sortedGlobalMarketTokens.length === 0 ? <TokenSkeletonList /> : <>{state.marketStatusMessage && <div className="ps-token-inline-status" role="status">{state.marketStatusMessage}</div>}{state.sortedGlobalMarketTokens.map((token) => row(token))}</>}</section>}
        {marketUnavailable && <div className="ps-token-inline-status" role="status">{TOKEN_DATA_UNAVAILABLE_MESSAGE}<span hidden>Token catalog is temporarily unavailable.</span></div>}
        {state.commonMarketTokens.length > 0 && <section className="ps-token-section"><SectionTitle>Tokens</SectionTitle>{state.commonMarketTokens.map((token) => row(token))}</section>}
''',
    '''        {!walletOnly && state.visibleRecentTokens.length > 0 && <section className="ps-token-section"><SectionTitle icon={<ClockIcon />} action={<button type="button" className="ps-token-section-action" onClick={state.clearRecentTokens}>Clear</button>}>Recent searches</SectionTitle>{state.visibleRecentTokens.map((token) => row(token, hasPositiveBalance(token)))}</section>}
        {!walletOnly && (state.sortedGlobalMarketTokens.length > 0 || loading) && <section className="ps-token-section"><SectionTitle icon={<TrendingIcon />}>Tokens</SectionTitle>{loading && state.sortedGlobalMarketTokens.length === 0 ? <TokenSkeletonList /> : <>{state.marketStatusMessage && <div className="ps-token-inline-status" role="status">{state.marketStatusMessage}</div>}{state.sortedGlobalMarketTokens.map((token) => row(token))}</>}</section>}
        {marketUnavailable && <div className="ps-token-inline-status" role="status">{TOKEN_DATA_UNAVAILABLE_MESSAGE}<span hidden>Token catalog is temporarily unavailable.</span></div>}
        {!walletOnly && state.commonMarketTokens.length > 0 && <section className="ps-token-section"><SectionTitle>Tokens</SectionTitle>{state.commonMarketTokens.map((token) => row(token))}</section>}
''',
    "wallet-only sections",
)
path.write_text(text)

path = Path("src/features/wallet/components/wallet/SendAssetDialog.jsx")
text = path.read_text()
text = text.replace("    Search,\n", "")
text = replace_once(
    text,
    '''import {
    usePublicClient,
    useSendTransaction,
    useWriteContract,
} from '#wallet-runtime'

import TokenIcon from '../../../tokens/components/TokenIcon.jsx'
import TransactionStatusDialog from './TransactionStatusDialog.jsx'
import WalletAssetList from './WalletAssetList.jsx'
''',
    '''import {
    useAppKitNetwork,
    usePublicClient,
    useSendTransaction,
    useWriteContract,
} from '#wallet-runtime'

import TokenIcon from '../../../tokens/components/TokenIcon.jsx'
import TokenSelector from '../../../tokens/components/TokenSelector.jsx'
import TransactionStatusDialog from './TransactionStatusDialog.jsx'
''',
    "Send imports",
)
text, count = re.subn(
    r"\nfunction matchesExactContract\(token, search\) \{.*?\n\}\n",
    "\n",
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit(f"matchesExactContract removal: expected 1 match, found {count}")

start = text.index("}) {\n    const numericChainId = Number(chainId)")
end = text.index("\n    function updateAmount(event) {", start)
replacement = '''}) {
    const numericWalletChainId = Number(chainId)
    const { chainId: connectedChainId, switchNetwork } = useAppKitNetwork()
    const { mutateAsync: sendTransactionAsync } = useSendTransaction()
    const { mutateAsync: writeContractAsync } = useWriteContract()
    const [selectedToken, setSelectedToken] = useState(null)
    const [showSelector, setShowSelector] = useState(false)
    const [selectorChainId, setSelectorChainId] = useState('all')
    const [search, setSearch] = useState('')
    const [amount, setAmount] = useState('')
    const [recipient, setRecipient] = useState('')
    const [error, setError] = useState(null)
    const [mode, setMode] = useState('edit')
    const [status, setStatus] = useState('idle')
    const [review, setReview] = useState(null)
    const [hash, setHash] = useState(null)
    const heldAssets = assets.filter(isPositiveWalletBalance)
    const defaultSelectedToken = sortWalletAssetsByValue(filterPortfolioTokens(
        heldAssets,
        settings,
    ))[0] ?? null
    const activeSelectedToken = selectedToken ?? defaultSelectedToken
    const numericChainId = Number(activeSelectedToken?.chainId ?? numericWalletChainId)
    const chain = getCuratedEvmChain(numericChainId)
    const nativeSymbol = chain?.nativeCurrency?.symbol ?? 'native token'
    const publicClient = usePublicClient({
        chainId: isCuratedEvmChainId(numericChainId)
            ? numericChainId
            : undefined,
    })
    const selectedNativeAsset = assets.find((token) =>
        Number(token?.chainId) === numericChainId && isNativeEvmToken(token)) ?? null
    const selectedNativeBalanceWei = selectedNativeAsset
        ? getTokenBalanceWei(selectedNativeAsset)
        : numericChainId === numericWalletChainId
            ? BigInt(nativeBalanceWei ?? 0)
            : 0n
    const selectedExplorerUrl = chain?.blockExplorers?.default?.url ?? explorerUrl
    const reviewedAccountChanged = Boolean(
        review?.account &&
        review.account.toLowerCase() !== String(address).toLowerCase(),
    )
    const currentMode = reviewedAccountChanged ? 'edit' : mode
    const displayError = reviewedAccountChanged
        ? 'The connected account changed. Review the send again.'
        : error
'''
text = text[:start] + replacement + text[end:]

text = replace_once(
    text,
    "            nativeBalanceWei,\n            estimatedFeeWei: review?.feeWei ?? null,",
    "            nativeBalanceWei: selectedNativeBalanceWei,\n            estimatedFeeWei: review?.feeWei ?? null,",
    "useMax balance",
)
text = replace_once(
    text,
    '''                chainId,
                recipient,
                amount,
                token: activeSelectedToken,
                nativeBalanceWei,
                estimatedFeeWei: 0n,''',
    '''                chainId: numericChainId,
                recipient,
                amount,
                token: activeSelectedToken,
                nativeBalanceWei: selectedNativeBalanceWei,
                estimatedFeeWei: 0n,''',
    "initial transfer plan",
)
text = replace_once(
    text,
    '''                chainId,
                recipient,
                amount,
                token: activeSelectedToken,
                nativeBalanceWei,
                estimatedFeeWei: feeWei,''',
    '''                chainId: numericChainId,
                recipient,
                amount,
                token: activeSelectedToken,
                nativeBalanceWei: selectedNativeBalanceWei,
                estimatedFeeWei: feeWei,''',
    "final transfer plan",
)
text = replace_once(
    text,
    '''        if (Number(chainId) !== Number(review.plan.request.chainId)) {
            setMode('edit')
            setReview(null)
            setStatus('idle')
            setError('The active network changed. Switch back and review again.')
            return
        }
''',
    "",
    "remove manual network blocker",
)
text = replace_once(
    text,
    '''        setError(null)
        setStatus('confirming')
        try {
            let transactionHash
''',
    '''        const targetChain = getCuratedEvmChain(Number(review.chainId))
        if (!targetChain) {
            setError('This network is not enabled in PistachioSwap.')
            return
        }
        setError(null)
        setStatus('confirming')
        let phase = 'switch-network'
        try {
            if (Number(connectedChainId) !== Number(review.chainId)) {
                await switchNetwork(targetChain)
            }
            phase = 'send'
            let transactionHash
''',
    "auto switch before send",
)
text = replace_once(
    text,
    '''                setStatus('rejected')
                setError('The send was rejected in the wallet.')
''',
    '''                setStatus('rejected')
                setError(phase === 'switch-network'
                    ? `Network switch to ${targetChain.name} was cancelled.`
                    : 'The send was rejected in the wallet.')
''',
    "network rejection message",
)
text = replace_once(
    text,
    "? formatEther(BigInt(nativeBalanceWei ?? 0))",
    "? formatEther(selectedNativeBalanceWei)",
    "native token balance",
)
text = replace_once(
    text,
    '''? BigInt(nativeBalanceWei ?? 0)
                : getTokenBalanceWei(review.token))''',
    '''? selectedNativeBalanceWei
                : getTokenBalanceWei(review.token))''',
    "after native balance",
)
text = replace_once(
    text,
    "<Dialog.Title>{showSelector ? 'Select token' : 'Send'}</Dialog.Title>",
    "<Dialog.Title>Send</Dialog.Title>",
    "send title",
)
pattern = re.compile(
    r'''                    \{showSelector \? \(
                        <div className="send-token-selector">.*?
                        </div>
                    \) : \(
                        <>''',
    re.S,
)
text, count = pattern.subn("                    {!showSelector && (\n                        <>", text, count=1)
if count != 1:
    raise SystemExit(f"send selector branch: expected 1 match, found {count}")
text = replace_once(
    text,
    "<TransactionStatusDialog status={status} hash={hash} explorerUrl={explorerUrl} />",
    "<TransactionStatusDialog status={status} hash={hash} explorerUrl={selectedExplorerUrl} />",
    "send explorer",
)
text = replace_once(
    text,
    '''                </Dialog.Content>
            </Dialog.Portal>''',
    '''                </Dialog.Content>
                {showSelector && (
                    <TokenSelector
                        side="send"
                        chainId={selectorChainId}
                        tokens={[]}
                        commonTokens={[]}
                        fallbackTokens={[]}
                        walletTokens={heldAssets}
                        search={search}
                        loading={false}
                        error={null}
                        currentToken={null}
                        oppositeToken={null}
                        onSearchChange={setSearch}
                        onSelect={(token) => {
                            setSelectedToken(token)
                            setShowSelector(false)
                            setSelectorChainId('all')
                            setSearch('')
                            setAmount('')
                            setReview(null)
                            setStatus('idle')
                            setError(null)
                        }}
                        onClose={() => {
                            setShowSelector(false)
                            setSelectorChainId('all')
                            setSearch('')
                        }}
                        hideUnknownTokens={false}
                        hideSmallBalances={false}
                        onChainChange={setSelectorChainId}
                        walletOnly
                    />
                )}
            </Dialog.Portal>''',
    "mount exact selector",
)
path.write_text(text)

path = Path("src/features/wallet/components/wallet/SendAssetDialog.test.jsx")
text = path.read_text()
text = replace_once(
    text,
    '''    write: vi.fn(),
    publicClient: {''',
    '''    write: vi.fn(),
    switchNetwork: vi.fn(),
    runtimeChainId: 56,
    publicClient: {''',
    "test mocks state",
)
text = replace_once(
    text,
    '''vi.mock('#wallet-runtime', () => ({
    usePublicClient: () => mocks.publicClient,''',
    '''vi.mock('#wallet-runtime', () => ({
    useAppKitNetwork: () => ({
        chainId: mocks.runtimeChainId,
        switchNetwork: mocks.switchNetwork,
    }),
    usePublicClient: () => mocks.publicClient,''',
    "test runtime mock",
)
text = replace_once(
    text,
    "const blocked = {\n",
    '''const polygonNative = {
    ...native,
    chainId: 137,
    name: 'Polygon',
    symbol: 'POL',
    rawBalance: parseEther('2').toString(),
    balance: '2',
    priceUSD: '1',
    valueUSD: '2',
    logoURI: '/icons/polygon.svg',
}
const blocked = {
''',
    "polygon fixture",
)
text = replace_once(
    text,
    "    beforeEach(() => window.localStorage.clear())",
    '''    beforeEach(() => {
        window.localStorage.clear()
        mocks.runtimeChainId = 56
        mocks.switchNetwork.mockResolvedValue(undefined)
    })''',
    "test beforeEach",
)
text = text.replace("screen.getByLabelText('Search wallet assets')", "screen.getByLabelText('Search tokens')")
text = text.replace(
    "expect(screen.getByRole('button', { name: 'Hidden tokens (1)' })).toBeTruthy()\n",
    "expect(screen.getByText('This token is hidden from normal results. Review the exact contract and risk reason before selecting it.')).toBeTruthy()\n",
)
text = text.replace(
    '''        expect(screen.getByRole('button', { name: 'Hidden tokens (1)' }))
            .toBeTruthy()
''',
    '''        expect(screen.getByText('This token is hidden from normal results. Review the exact contract and risk reason before selecting it.')).toBeTruthy()
''',
)
insert_at = text.index("    it('requires an extra acknowledgement before reviewing a blocked token'")
multichain_test = '''    it('uses the exact token selector across wallet chains and auto-switches on send', async () => {
        mocks.send.mockResolvedValue('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
        renderDialog({ assets: [native, polygonNative] })

        fireEvent.click(screen.getByRole('button', { name: /BNB/ }))
        expect(screen.getByRole('dialog', { name: 'Select a token for send' })).toBeTruthy()
        expect(screen.getByText('Your tokens')).toBeTruthy()
        expect(screen.getByRole('button', { name: 'Token network' }).textContent).toContain('All Chains')
        expect(screen.queryByText('Show all wallet assets')).toBeNull()
        expect(screen.queryByText('Use portfolio filters')).toBeNull()
        expect(screen.queryByText("Token data couldn't be reached.")).toBeNull()

        const polygonRow = screen.getByText('Polygon', { selector: 'strong' }).closest('button')
        expect(polygonRow).toBeTruthy()
        fireEvent.click(polygonRow)
        fireEvent.change(screen.getByLabelText('Amount to send'), { target: { value: '0.5' } })
        fireEvent.change(screen.getByLabelText('Send to'), { target: { value: recipient } })
        fireEvent.click(screen.getByRole('button', { name: 'Review send' }))

        await screen.findByRole('heading', { name: 'Review send' })
        expect(screen.getByText('Polygon')).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: 'Confirm in wallet' }))

        await waitFor(() => expect(mocks.switchNetwork).toHaveBeenCalledOnce())
        expect(mocks.switchNetwork).toHaveBeenCalledWith(expect.objectContaining({ id: 137 }))
        await waitFor(() => expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ chainId: 137 })))
    })

'''
text = text[:insert_at] + multichain_test + text[insert_at:]
path.write_text(text)
