import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
}

type State = {
  error: Error | null
}

class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Route render failed', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="route-error" role="alert">
        <span>WORKSPACE UNAVAILABLE</span>
        <h1>当前页面没有正确载入</h1>
        <p>已保留当前位置。可以重新载入本页，或先返回首页。</p>
        <div>
          <button onClick={() => window.location.reload()} type="button">重新载入</button>
          <a href="#/">返回首页</a>
        </div>
      </main>
    )
  }
}

export default ErrorBoundary
