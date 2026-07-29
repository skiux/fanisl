import { useEffect, useState } from 'react'
import App from './App'
import ArchivePage from './features/archive/ArchivePage'
import DiscoveryPage from './features/discovery/DiscoveryPage'
import KnowledgePage from './features/knowledge/KnowledgePage'
import VerificationPage from './features/verification/VerificationPage'

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

  if (route === 'knowledge') return <KnowledgePage />
  if (route === 'verification') return <VerificationPage />
  if (route === 'discovery') return <DiscoveryPage />
  if (route === 'archive') return <ArchivePage />
  return <App />
}

export default Root
