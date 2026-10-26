import { useEffect, useState } from 'react'
function currentView() {
    if (typeof window === 'undefined') return 'trade'
    const view = new URLSearchParams(window.location.search).get('view')
    return ['portfolio', 'token'].includes(view) ? view : 'trade'
}
export function useAppView() {
    const [view, setView] = useState(currentView)
    useEffect(() => {
        const sync = () => setView(currentView())
        const navigate = event => setView(['portfolio', 'token'].includes(event.detail?.view) ? event.detail.view : 'trade')
        window.addEventListener('popstate', sync)
        window.addEventListener('pistachio:navigate-app', navigate)
        return () => {
            window.removeEventListener('popstate', sync)
            window.removeEventListener('pistachio:navigate-app', navigate)
        }
    }, [])
    return view
}
