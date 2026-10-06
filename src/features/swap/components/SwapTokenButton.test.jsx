// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SwapTokenButton } from './SwapTokenButton.jsx'

afterEach(cleanup)

it.each([[10, 'OP Mainnet'], [8453, 'Base']])('shows the network badge for native ETH on chain %s', (chainId, name) => {
    const { getByLabelText, getByText } = render(
        <SwapTokenButton token={{ chainId, address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', isNative: true }} onClick={() => {}} />,
    )
    expect(getByLabelText(`${name} network`)).toBeTruthy()
    expect(getByText('ETH')).toBeTruthy()
})
