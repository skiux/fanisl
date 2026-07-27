import { useEffect, useState } from 'react'
import App from './App'
import KnowledgePage from './features/knowledge/KnowledgePage'

type Route = 'home' | 'knowledge'

function readRoute(): Route {
  return window.location.hash.startsWith('#/knowledge') ? 'knowledge' : 'home'
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
      : 'FANISL · 个人投资知识引擎'
  }, [route])

  return route === 'knowledge' ? <KnowledgePage /> : <App />
}

export default Root
