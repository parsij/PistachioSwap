import {
    useMemo,
    useState,
} from 'react'

import {
    getTokenFallbackLetter,
    getTokenLogoCandidates,
} from './tokenIconUtils.js'
import {
    getFailedTokenLogoUrls,
    getSuccessfulTokenLogoUrl,
    markTokenLogoFailed,
    markTokenLogoSuccessful,
} from './tokenLogoCache.js'
import {
    getCanonicalTokenAddress,
    getCuratedEvmChain,
    getCuratedEvmChainLogoUri,
} from '../../../web3/curatedEvmChains.js'

function NetworkFallbackIcon({
                                 token,
                             }) {
    const label = String(
        token?.chainSymbol ??
        token?.networkSymbol ??
        token?.chainId ??
        '?',
    )
        .trim()
        .slice(0, 1)
        .toUpperCase()

    return (
        <span className="ps-network-fallback">
      {label}
    </span>
    )
}

function TokenLogoImage({
                            candidates,
                            fallbackLetter,
                            canonicalIdentity,
                        }) {
    const [candidateIndex, setCandidateIndex] =
        useState(() => {
            const failedUrls = getFailedTokenLogoUrls(canonicalIdentity)
            const successful = getSuccessfulTokenLogoUrl(canonicalIdentity)
            const successfulIndex = candidates.indexOf(successful)
            if (successfulIndex >= 0) return successfulIndex
            const firstUsable = candidates.findIndex((url) => !failedUrls.has(url))
            return firstUsable >= 0 ? firstUsable : candidates.length
        })
    const candidate = candidates[candidateIndex] ?? null

    return candidate ? (
        <img
            src={candidate}
            alt=""
            className="ps-token-main-logo"
            draggable="false"
            onLoad={() => markTokenLogoSuccessful(canonicalIdentity, candidate)}
            onError={() => {
                markTokenLogoFailed(canonicalIdentity, candidate)
                const failedUrls = getFailedTokenLogoUrls(canonicalIdentity)
                setCandidateIndex((current) => {
                    const next = candidates.findIndex(
                        (url, index) => index > current && !failedUrls.has(url),
                    )
                    return next >= 0 ? next : candidates.length
                })
            }}
        />
    ) : (
        <span className="ps-token-logo-fallback">
          {fallbackLetter}
        </span>
    )
}

function ChainLogoImage({
                            chainLogo,
                            token,
                        }) {
    const [failed, setFailed] = useState(false)

    return chainLogo && !failed ? (
        <img
            src={chainLogo}
            alt=""
            draggable="false"
            onError={() => setFailed(true)}
        />
    ) : (
        <NetworkFallbackIcon token={token} />
    )
}

export function ChainIcon({
                              chainId,
                              name = null,
                              className = '',
                          }) {
    const chain = getCuratedEvmChain(chainId)
    const chainName = name ?? chain?.name ?? `Chain ${chainId}`
    const [failed, setFailed] = useState(false)
    const logoURI = getCuratedEvmChainLogoUri(chainId)

    return (
        <span className={['ps-chain-icon', className].filter(Boolean).join(' ')}>
            <span aria-hidden="true">{chainName.slice(0, 1)}</span>
            {logoURI && !failed && (
                <img
                    src={logoURI}
                    alt=""
                    draggable="false"
                    onError={() => setFailed(true)}
                />
            )}
        </span>
    )
}

/**
 * Renders token artwork with cached candidate fallback and deterministic letter fallback.
 * @param {object} props Token, size, and optional class/presentation fields.
 * @returns {import('react').ReactElement} Token icon image or fallback.
 * @sideEffects Browser image loads update the in-memory logo success/failure cache.
 */
export default function TokenIcon({
                                      token,
                                      size = 'list',
                                      showChainBadge = true,
                                  }) {
    const tokenLogos = useMemo(
        () => getTokenLogoCandidates(token),
        [token],
    )
    const tokenLogoKey = tokenLogos.join('|')

    const chainLogo =
        getCuratedEvmChainLogoUri(token?.chainId) ??
        token?.chainLogoURI ??
        token?.networkLogoURI ??
        token?.chain?.logoURI ??
        null
    const chainName = getCuratedEvmChain(token?.chainId)?.name ??
        `Chain ${token?.chainId}`

    const fallbackLetter = getTokenFallbackLetter(token)
    const canonicalAddress = getCanonicalTokenAddress(token?.chainId, token?.address)
    const canonicalIdentity = `${Number(token?.chainId)}:${canonicalAddress ?? token?.address ?? ''}`

    return (
        <span
            className={[
                'ps-token-icon',
                `ps-token-icon-${size}`,
            ].join(' ')}
        >
      <TokenLogoImage
          key={tokenLogoKey}
          candidates={tokenLogos}
          fallbackLetter={fallbackLetter}
          canonicalIdentity={canonicalIdentity}
      />

            {showChainBadge && (
                <span
                    className="ps-token-network-badge"
                    title={chainName}
                    aria-label={`${chainName} network`}
                >
          <ChainLogoImage
              key={chainLogo ?? 'chain-fallback'}
              chainLogo={chainLogo}
              token={token}
          />
        </span>
            )}
    </span>
    )
}
