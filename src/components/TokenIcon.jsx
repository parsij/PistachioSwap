import {
    useMemo,
    useState,
} from 'react'

import {
    getTokenFallbackLetter,
    getTokenLogoCandidates,
} from './tokenIconUtils.js'

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
                        }) {
    const [candidateIndex, setCandidateIndex] =
        useState(0)
    const candidate = candidates[candidateIndex] ?? null

    return candidate ? (
        <img
            src={candidate}
            alt=""
            className="ps-token-main-logo"
            draggable="false"
            onError={() =>
                setCandidateIndex(
                    (current) => current + 1,
                )
            }
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
        token?.chainLogoURI ??
        token?.networkLogoURI ??
        token?.chain?.logoURI ??
        null

    const fallbackLetter = getTokenFallbackLetter(token)

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
      />

            {showChainBadge && (
                <span className="ps-token-network-badge">
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
