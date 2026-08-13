import { lazy, Suspense, useEffect, useState } from 'react'
import App from './App'
import ErrorBoundary from './shared/ErrorBoundary'

const ArchivePage = lazy(() => import('./features/archive/ArchivePage'))
const DiscoveryPage = lazy(() => import('./features/discovery/DiscoveryPage'))
const KnowledgePage = lazy(() => import('./features/knowledge/KnowledgePage'))
const VerificationPage = lazy(() => import('./features/verification/VerificationPage'))

type Route = 'home' | 'knowledge' | 'verification' | 'discovery' | 'archive'

function readRoute(): Route {
  if (window.location.hash.startsWith('#/knowledge')) return 'knowledge'
  if (window.location.hash.startsWith('#/verification')) return 'verification'
  if (window.location.hash.startsWith('#/discovery')) return 'discovery'
  if (window.location.hash.startsWith('#/archive')) return 'archive'
  return 'home'
}

function Root() {
  const [route, setRoute] = useState<Route>(readRoute)

  useEffect(() => {
    const update = () => setRoute(readRoute())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  useEffect(() => {
    window.scrollTo({ left: 0, top: 0 })
    document.title = route === 'knowledge'
      ? '知识库 · FANISL'
      : route === 'verification'
        ? '验证中心 · FANISL'
        : route === 'discovery'
          ? '发现 · FANISL'
          : route === 'archive'
            ? '研究档案 · FANISL'
            : 'FANISL · 个人投资知识引擎'
  }, [route])

  if (route !== 'home') {
    const page = route === 'knowledge'
      ? <KnowledgePage />
      : route === 'verification'
        ? <VerificationPage />
        : route === 'discovery'
          ? <DiscoveryPage />
          : <ArchivePage />
    return <ErrorBoundary key={route}><Suspense fallback={<main className="route-loading"><span>FANISL</span><p>正在进入工作区</p></main>}>{page}</Suspense></ErrorBoundary>
  }
  return <ErrorBoundary key={route}><App /></ErrorBoundary>
}

export default Root
