import { expect, it } from 'vitest'
import { withinReviewedQuoteBounds } from './reviewedQuoteBounds.js'
import { reviewedSponsorshipOrderChanged } from '../hooks/usePrepaidSponsorship.js'

const reviewed = { walletAddress: '0x1111111111111111111111111111111111111111',
    recipient: '0x1111111111111111111111111111111111111111', chainId: 56,
    sellToken: '0x2222222222222222222222222222222222222222',
    buyToken: '0x3333333333333333333333333333333333333333',
    paymentToken: '0x2222222222222222222222222222222222222222',
    grossInputAmountRaw: '100', netSwapAmountRaw: '90', paymentAmountRaw: '10',
    minimumOutputRaw: '80', expectedOutputRaw: '85', totalPrepaymentUsdMicros: '10000' }
const allowed = (created) => withinReviewedQuoteBounds(reviewed, created, reviewedSponsorshipOrderChanged)

it('accepts fresh output and fees only within the confirmed economic limits', () => {
    expect(allowed({ ...reviewed, expectedOutputRaw: '84' })).toBe(true)
    expect(allowed({ ...reviewed, paymentAmountRaw: '9', netSwapAmountRaw: '91', totalPrepaymentUsdMicros: '9000' })).toBe(true)
})
it.each([
    { minimumOutputRaw: '79' }, { paymentAmountRaw: '11' }, { totalPrepaymentUsdMicros: '10001' },
    { recipient: '0x4444444444444444444444444444444444444444' }, { chainId: 137 },
    { grossInputAmountRaw: '101' }, { quoteProvider: 'changed' }, { expectedOutputRaw: '79' },
    { paymentAmountRaw: '-1' }, { minimumOutputRaw: undefined }, { sellToken: reviewed.buyToken },
])('requires renewed confirmation for changed or unprovable bounds: %j', (change) => {
    expect(allowed({ ...reviewed, ...change })).toBe(false)
})
