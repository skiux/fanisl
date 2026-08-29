import { lazy, Suspense, useEffect, useState } from 'react'
import App from './App'
import ErrorBoundary from './shared/ErrorBoundary'
import { routeFromHash, titleForRoute, type AppRoute } from './shared/navigation/route'

const ArchivePage = lazy(() => import('./features/archive/ArchivePage'))
const AssetPage = lazy(() => import('./features/asset/AssetPage'))
const DiscoveryPage = lazy(() => import('./features/discovery/DiscoveryPage'))
const KnowledgePage = lazy(() => import('./features/knowledge/KnowledgePage'))
const VerificationPage = lazy(() => import('./features/verification/VerificationPage'))

function Root() {
  const [route, setRoute] = useState<AppRoute>(() => routeFromHash(window.location.hash))

  useEffect(() => {
    const update = () => setRoute(routeFromHash(window.location.hash))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  useEffect(() => {
    window.scrollTo({ left: 0, top: 0 })
    document.title = titleForRoute(route)
  }, [route])

  if (route !== 'home') {
    const page = route === 'asset'
      ? <AssetPage />
      : route === 'knowledge'
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
