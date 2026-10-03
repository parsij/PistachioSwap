// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import TokenHoverCard from './TokenHoverCard.jsx'
const mocks = vi.hoisted(() => ({ fetchMarket: vi.fn() }))
vi.mock('../services/tokenDetails.js', () => ({ fetchTokenMarketDetails: mocks.fetchMarket }))
vi.mock('./TokenMarketChart.jsx', () => ({ default: () => <div>Preview chart</div> }))
vi.mock('./TokenIcon.jsx', () => ({ default: () => <span /> }))
const token = { chainId: 56, address: '0x1111111111111111111111111111111111111111', symbol: 'TEST' }

beforeEach(() => {
    vi.useFakeTimers()
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    mocks.fetchMarket.mockReset()
    mocks.fetchMarket.mockResolvedValue({ currentPriceUsd: 12, change24hPercent: 2, chart: { points: [] } })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
function setup() {
    const navigate = vi.fn()
    render(<TokenHoverCard token={token} onNavigate={navigate}><button>Token row</button></TokenHoverCard>)
    return navigate
}
function pointer(node, type) {
    const event = new Event(type, { bubbles: true })
    Object.defineProperty(event, 'pointerType', { value: 'mouse' })
    fireEvent(node, event)
}
async function advance(time) { await act(async () => { vi.advanceTimersByTime(time) }) }

it('waits for hover intent and lets its market request finish without cancelling itself', async () => {
    setup()
    pointer(screen.getByText('Token row'), 'pointerover')
    await advance(299)
    expect(mocks.fetchMarket).not.toHaveBeenCalled()
    await advance(1)
    expect(mocks.fetchMarket).toHaveBeenCalledOnce()
    expect(mocks.fetchMarket.mock.calls[0][1].signal.aborted).toBe(false)
    expect(screen.getByText('$12.00')).toBeTruthy()
})
it('cancels passing hover and keeps the card interactive across the row/card gap', async () => {
    const navigate = setup()
    const row = screen.getByText('Token row')
    pointer(row, 'pointerover')
    pointer(row, 'pointerout')
    await advance(400)
    expect(mocks.fetchMarket).not.toHaveBeenCalled()
    pointer(row, 'pointerover')
    await advance(300)
    pointer(row, 'pointerout')
    pointer(screen.getByRole('dialog'), 'pointerover')
    await advance(200)
    expect(screen.getByRole('button', { name: 'Open token details' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open token details' }))
    expect(navigate).toHaveBeenCalledWith(token)
})
it('closes after leaving the preview', async () => {
    setup()
    pointer(screen.getByText('Token row'), 'pointerover')
    await advance(300)
    pointer(screen.getByRole('dialog'), 'pointerout')
    await advance(250)
    expect(screen.queryByRole('dialog')).toBeNull()
})
it('does not fetch or emulate hover on touch', async () => {
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    setup()
    pointer(screen.getByText('Token row'), 'pointerover')
    await advance(500)
    expect(mocks.fetchMarket).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
})
it('preserves unavailable values instead of displaying zero', async () => {
    mocks.fetchMarket.mockResolvedValue({ currentPriceUsd: null, change24hPercent: null, chart: { points: [] } })
    setup()
    pointer(screen.getByText('Token row'), 'pointerover')
    await advance(300)
    expect(screen.getByText('Market data unavailable')).toBeTruthy()
    expect(screen.queryByText('$0.00')).toBeNull()
})
