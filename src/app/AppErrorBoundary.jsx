import { Component } from 'react'

export default class AppErrorBoundary extends Component {
    state = { error: null }

    static getDerivedStateFromError(error) {
        return { error }
    }

    componentDidCatch(error, info) {
        if (import.meta.env.DEV) {
            console.error('[app-error-boundary]', error, info)
        }
    }

    render() {
        if (!this.state.error) return this.props.children

        return (
            <main className="app-fatal-error" role="alert">
                <h1>PistachioSwap could not load</h1>
                <p>Your wallet has not been asked to sign or submit anything.</p>
                <button
                    type="button"
                    onClick={this.props.reload ?? (() => window.location.reload())}
                >
                    Reload
                </button>
            </main>
        )
    }
}
