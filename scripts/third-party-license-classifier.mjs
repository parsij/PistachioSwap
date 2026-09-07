const REOWN_NOTICE = 'Portions © 2025 Reown, Inc. All Rights Reserved.'
const METAMASK_NOTICE = 'Copyright ConsenSys Software Inc. 2022. All rights reserved.'

export const REQUIRED_NOTICES = {
    reown: REOWN_NOTICE,
    metamask: METAMASK_NOTICE,
}

function normalizeDeclaredLicense(value) {
    if (typeof value === 'string') return value.trim()
    if (value && typeof value === 'object' && typeof value.type === 'string') {
        return value.type.trim()
    }
    return ''
}

function inferPermissiveLicense(text) {
    if (/Permission is hereby granted, free of charge, to any person obtaining a copy/i.test(text)) {
        return 'MIT'
    }
    if (/Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee/i.test(text)) {
        return 'ISC'
    }
    if (/Apache License[\s\S]{0,80}Version 2\.0/i.test(text)) return 'Apache-2.0'
    if (/THE UNLICENSE|This is free and unencumbered software released into the public domain/i.test(text)) {
        return 'Unlicense / public domain dedication'
    }
    return ''
}

export function classifyPackagedLicense({ declaredLicense, licenseText }) {
    const declared = normalizeDeclaredLicense(declaredLicense)
    const text = String(licenseText || '')

    if (/REOWN COMMUNITY LICENSE AGREEMENT/i.test(text)) {
        return {
            group: 'reown-appkit',
            label: 'Reown Community License',
            requiredNotice: REOWN_NOTICE,
        }
    }

    if (/WALLETCONNECT COMMUNITY LICENSE AGREEMENT/i.test(text)) {
        return {
            group: 'walletconnect-community',
            label: 'WalletConnect Community License',
            requiredNotice: REOWN_NOTICE,
        }
    }

    if (
        /Copyright ConsenSys Software Inc\. 2022\. All rights reserved\./i.test(text)
        && /Non-Commercial Use/i.test(text)
    ) {
        return {
            group: 'metamask-custom',
            label: 'MetaMask / ConsenSys custom license',
            requiredNotice: METAMASK_NOTICE,
        }
    }

    const inferred = inferPermissiveLicense(text)
    const usableDeclared = declared && !/^SEE LICENSE\b/i.test(declared)
        ? declared
        : ''

    return {
        group: 'other',
        label: usableDeclared || inferred || 'See included license file',
        requiredNotice: null,
    }
}

export function displayDeclaredLicense(value) {
    return normalizeDeclaredLicense(value) || 'Not declared in package metadata'
}
