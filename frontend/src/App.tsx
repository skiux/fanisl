import { useCallback, useEffect, useRef, useState } from 'react'
import ArchiveScene from './ArchiveScene'
import type { KnowledgeOverview, KnowledgeUnitSummary } from './features/knowledge/types'
import { chapters, getActiveChapter } from './journey'
import { apiJson } from './shared/api/client'
import AppHeader from './shared/navigation/AppHeader'

const kindLabels = {
  claim: '判断',
  method: '方法',
  concept: '认知',
} as const

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])
  return matches
}

function SearchPanel({ close }: { close: () => void }) {
  const [query, setQuery] = useState('')
  const [resolvedQuery, setResolvedQuery] = useState('')
  const [results, setResults] = useState<KnowledgeUnitSummary[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const [requestKey, setRequestKey] = useState(0)

  useEffect(() => {
    const value = query.trim()
    if (!value) {
      setResults([])
      setResolvedQuery('')
      setState('idle')
      return
    }
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      setState('loading')
      const params = new URLSearchParams({ limit: '8', q: value })
      apiJson<KnowledgeUnitSummary[]>(`/knowledge/units?${params.toString()}`, { signal: controller.signal })
        .then((payload) => {
          setResults(payload)
          setResolvedQuery(value)
          setState('loaded')
        })
        .catch(() => {
          if (!controller.signal.aborted) setState('error')
        })
    }, 260)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [query, requestKey])

  const openResult = (unitId: number) => {
    const params = new URLSearchParams({ q: resolvedQuery, unit: String(unitId), view: 'evidence' })
    window.location.hash = `#/knowledge?${params.toString()}`
    close()
  }

  const openAllResults = () => {
    const params = new URLSearchParams({ q: query.trim(), view: 'evidence' })
    window.location.hash = `#/knowledge?${params.toString()}`
    close()
  }

  const status = state === 'idle'
    ? '搜索逐字引文与结构化知识单元'
    : state === 'loading'
      ? '正在检索知识库…'
      : state === 'error'
        ? '知识检索暂不可用'
        : results.length
          ? `${results.length} 条结果 · 按发布时间排列`
          : '没有匹配的证据'

  return (
    <div className="search-backdrop" onMouseDown={close} role="presentation">
      <section aria-label="搜索知识库" aria-modal="true" className="search-panel" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <div className="search-field">
          <span aria-hidden="true">⌕</span>
          <input aria-label="搜索知识库" autoFocus onChange={(event) => setQuery(event.target.value)} placeholder="搜索认知、方法、判断或主题" value={query} />
          <kbd>ESC</kbd><button aria-label="关闭搜索" onClick={close} type="button">×</button>
        </div>
        <p aria-live="polite">{status}</p>
        {results.map((item) => (
          <button key={item.id} onClick={() => openResult(item.id)} type="button">
            <small>{kindLabels[item.kind]}</small>
            <span className="search-result-copy"><strong>{item.content_title}</strong><em>{item.quote}</em></span>
            <span aria-hidden="true">↗</span>
          </button>
        ))}
        {state === 'idle' && <div className="no-result">输入主题、标的、判断原句或方法名称</div>}
        {state === 'loading' && <div className="no-result">正在读取当前知识库</div>}
        {state === 'loaded' && results.length === 0 && <div className="no-result">没有找到对应的逐字证据</div>}
        {state === 'error' && <button className="search-retry" onClick={() => setRequestKey((value) => value + 1)} type="button">重新检索</button>}
        {state === 'loaded' && results.length > 0 && <button className="search-all" onClick={openAllResults} type="button">在知识库中查看全部结果 <span>↗</span></button>}
      </section>
    </div>
  )
}

function StaticJourney({ openSearch }: { openSearch: () => void }) {
  return (
    <main className="static-journey">
      {chapters.map((chapter, index) => (
        <section className={`static-chapter static-${chapter.id}`} id={chapter.id} key={chapter.id}>
          <span className="static-index" aria-hidden="true">{chapter.index}</span>
          <p>{chapter.index} · {chapter.english}</p>
          <h1>{chapter.title}</h1>
          <div><span>{chapter.description}</span>{index === 5 && <button onClick={openSearch} type="button">搜索当前知识库 ↗</button>}</div>
        </section>
      ))}
    </main>
  )
}

function App() {
  const [active, setActive] = useState(0)
  const activeRef = useRef(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [stats, setStats] = useState<KnowledgeOverview | null>(null)
  const [statsState, setStatsState] = useState<'loading' | 'live' | 'error'>('loading')
  const [statsRequestKey, setStatsRequestKey] = useState(0)
  const progress = useRef(0)
  const targetProgress = useRef(0)
  const progressNumber = useRef<HTMLSpanElement>(null)
  const progressBar = useRef<HTMLSpanElement>(null)
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const staticExperience = reducedMotion

  useEffect(() => {
    const controller = new AbortController()
    setStatsState('loading')
    apiJson<KnowledgeOverview>('/knowledge/overview', { signal: controller.signal })
      .then((payload) => {
        setStats(payload)
        setStatsState('live')
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStats(null)
          setStatsState('error')
        }
      })
    return () => controller.abort()
  }, [statsRequestKey])

  const jumpTo = useCallback((index: number) => {
    if (staticExperience) {
      document.getElementById(chapters[index].id)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' })
      return
    }
    const maximum = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
    window.scrollTo({ behavior: 'smooth', top: chapters[index].stop * maximum })
  }, [reducedMotion, staticExperience])

  useEffect(() => {
    if (staticExperience) return
    let frame = 0
    const readScroll = () => {
      const maximum = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
      targetProgress.current = Math.min(1, Math.max(0, window.scrollY / maximum))
      const nextActive = getActiveChapter(targetProgress.current)
      if (nextActive !== activeRef.current) { activeRef.current = nextActive; setActive(nextActive) }
    }
    let previousTime = performance.now()
    const update = (time: number) => {
      const delta = Math.min(0.05, Math.max(0, (time - previousTime) / 1000))
      previousTime = time
      const difference = targetProgress.current - progress.current
      progress.current += difference * (1 - Math.exp(-delta * 7.4))
      if (Math.abs(difference) < 0.0001) progress.current = targetProgress.current
      if (progressNumber.current) progressNumber.current.textContent = `${Math.round(progress.current * 100).toString().padStart(2, '0')}%`
      if (progressBar.current) progressBar.current.style.transform = `scaleX(${progress.current})`
      frame = window.requestAnimationFrame(update)
    }
    readScroll()
    window.addEventListener('scroll', readScroll, { passive: true })
    window.addEventListener('resize', readScroll)
    frame = window.requestAnimationFrame(update)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', readScroll)
      window.removeEventListener('resize', readScroll)
    }
  }, [staticExperience])

  useEffect(() => {
    if (!staticExperience) return
    const sections = chapters.map((chapter) => document.getElementById(chapter.id)).filter((item): item is HTMLElement => Boolean(item))
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
      if (!visible) return
      const next = chapters.findIndex((chapter) => chapter.id === visible.target.id)
      if (next >= 0 && next !== activeRef.current) { activeRef.current = next; setActive(next) }
    }, { rootMargin: '-25% 0px -45%', threshold: [0.25, 0.5, 0.75] })
    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [staticExperience])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(true) }
      if (event.key === 'Escape') setSearchOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('modal-open', searchOpen)
    return () => document.body.classList.remove('modal-open')
  }, [searchOpen])

  const openSearch = () => setSearchOpen(true)

  if (staticExperience) {
    return (
      <div className="static-shell">
        <AppHeader onHomeClick={() => jumpTo(0)} onSearch={openSearch} />
        <StaticJourney openSearch={openSearch} />
        {searchOpen && <SearchPanel close={() => setSearchOpen(false)} />}
      </div>
    )
  }

  return (
    <div className="spatial-experience">
      <div className="scroll-track" aria-hidden="true">
        {chapters.map((chapter) => <span className="scroll-marker" id={chapter.id} key={chapter.id} style={{ top: `${chapter.stop * 100}%` }} />)}
      </div>
      <div className="fixed-stage">
        <div className="scene-canvas">
          <ArchiveScene
            active={active}
            openSearch={openSearch}
            progress={progress}
            retryStats={() => setStatsRequestKey((value) => value + 1)}
            stats={stats}
            statsState={statsState}
          />
        </div>
        <AppHeader onHomeClick={() => jumpTo(0)} onSearch={openSearch} />
        <aside aria-label="空间章节" className="chapter-rail">
          {chapters.map((chapter, index) => (
            <button aria-current={active === index ? 'step' : undefined} aria-label={`前往${chapter.label}`} key={chapter.id} onClick={() => jumpTo(index)} type="button">
              <i /><span>{chapter.index}</span><strong>{chapter.label}</strong>
            </button>
          ))}
        </aside>
        <div className="journey-hud" aria-hidden="true"><div><span>{chapters[active].index}</span><strong>{chapters[active].english}</strong></div><div className="progress-rule"><span ref={progressBar} /></div><span ref={progressNumber}>00%</span></div>
        <div className="scroll-cue" aria-hidden="true"><span>{active === 0 ? 'SCROLL TO ENTER' : active === 5 ? 'KNOWLEDGE, WITH A MEMORY' : 'MOVE THROUGH THE ARCHIVE'}</span><i /></div>
      </div>
      {searchOpen && <SearchPanel close={() => setSearchOpen(false)} />}
    </div>
  )
}

export default App
