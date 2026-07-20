const failedUrlsByIdentity = new Map()
const successfulUrlByIdentity = new Map()

/** Returns a copy of failed logo URLs recorded for one canonical token identity. */
export function getFailedTokenLogoUrls(identity) {
    return failedUrlsByIdentity.get(identity) ?? new Set()
}

/** Records a failed logo candidate in the in-memory render cache. */
export function markTokenLogoFailed(identity, url) {
    const failed = getFailedTokenLogoUrls(identity)
    failed.add(url)
    failedUrlsByIdentity.set(identity, failed)
}

/** Returns the last successful logo URL for one token identity, if known. */
export function getSuccessfulTokenLogoUrl(identity) {
    return successfulUrlByIdentity.get(identity) ?? null
}

/** Records the preferred successful logo URL for subsequent renders. */
export function markTokenLogoSuccessful(identity, url) {
    successfulUrlByIdentity.set(identity, url)
}

/** Clears module-local logo outcomes for deterministic tests; production callers do not use this export. */
export function clearTokenLogoCacheForTest() {
    failedUrlsByIdentity.clear()
    successfulUrlByIdentity.clear()
}
