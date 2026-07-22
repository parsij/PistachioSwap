import { useEffect, useState } from 'react'

import {
    readWalletActivity,
    subscribeWalletActivity,
} from '../services/walletActivity.js'

export function useWalletActivity({
    walletAddress,
    limit = 50,
} = {}) {
    const [items, setItems] = useState(() =>
        readWalletActivity({ walletAddress, limit }))

    useEffect(() => {
        const refresh = () => setItems(
            readWalletActivity({ walletAddress, limit }),
        )
        refresh()
        return subscribeWalletActivity(refresh)
    }, [limit, walletAddress])

    return items
}
