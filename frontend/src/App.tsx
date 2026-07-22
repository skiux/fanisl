import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { chapters, getActiveChapter } from './journey'

const SpatialScene = lazy(() => import('./SpatialScene'))

const searchItems = [
  { kind: '认知', title: 'AI 时代的软件收费：席位 → 按量 → 按结果', chapter: 3 },
  { kind: '方法', title: 'EMA 隧道：用多周期结构识别趋势与防守位', chapter: 2 },
  { kind: '判断', title: '标普 500 2026 年底 8200 点', chapter: 2 },
  { kind: '发现', title: '半导体“数字地租”与传统周期解释的分歧', chapter: 4 },
] as const

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

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

function smoothstep(start: number, end: number, value: number) {
  const phase = Math.min(1, Math.max(0, (value - start) / (end - start)))
  return phase * phase * (3 - 2 * phase)
}

function MaterialBackdrop({ progress }: { progress: RefObject<number> }) {
  const source = useRef<HTMLImageElement>(null)
  const sourceDetail = useRef<HTMLImageElement>(null)
  const node = useRef<HTMLImageElement>(null)
  const nodeDetail = useRef<HTMLImageElement>(null)
  const glow = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let frame = 0
    const update = () => {
      const value = Math.min(1, Math.max(0, progress.current))
      const sourceOpacity = 0.92 * (1 - smoothstep(0.55, 0.84, value))
      const nodeOpacity = smoothstep(0.31, 0.7, value) * (0.78 + smoothstep(0.7, 1, value) * 0.2)

      if (source.current) {
        source.current.style.opacity = sourceOpacity.toFixed(3)
        source.current.style.transform = `scale(${(1.025 + value * 0.39).toFixed(4)}) translate3d(${(-value * 4.8).toFixed(3)}%, ${(value * 1.8).toFixed(3)}%, 0)`
      }
      if (sourceDetail.current) {
        sourceDetail.current.style.opacity = (sourceOpacity * (0.12 + smoothstep(0.08, 0.48, value) * 0.16)).toFixed(3)
        sourceDetail.current.style.transform = `scale(${(1.16 + value * 0.68).toFixed(4)}) translate3d(${(-3 - value * 9).toFixed(3)}%, ${(4 + value * 3).toFixed(3)}%, 0)`
      }
      if (node.current) {
        node.current.style.opacity = nodeOpacity.toFixed(3)
        node.current.style.transform = `scale(${(0.86 + value * 0.28).toFixed(4)}) translate3d(${(4.5 - value * 4.5).toFixed(3)}%, ${(2.5 - value * 2.5).toFixed(3)}%, 0)`
      }
      if (nodeDetail.current) {
        nodeDetail.current.style.opacity = (nodeOpacity * smoothstep(0.48, 0.82, value) * 0.19).toFixed(3)
        nodeDetail.current.style.transform = `scale(${(1.08 + value * 0.34).toFixed(4)}) translate3d(${(9 - value * 13).toFixed(3)}%, ${(6 - value * 5).toFixed(3)}%, 0)`
      }
      if (glow.current) {
        glow.current.style.opacity = (0.18 + smoothstep(0.46, 0.9, value) * 0.28).toFixed(3)
        glow.current.style.transform = `translate3d(${(24 - value * 35).toFixed(3)}%, ${(8 - value * 13).toFixed(3)}%, 0) scale(${(0.82 + value * 0.45).toFixed(4)})`
      }
      frame = window.requestAnimationFrame(update)
    }
    frame = window.requestAnimationFrame(update)
    return () => window.cancelAnimationFrame(frame)
  }, [progress])

  return (
    <div className="material-backdrop" aria-hidden="true">
      <img className="matter-image matter-source" decoding="async" draggable="false" ref={source} src="/assets/knowledge-matter-source.jpg" />
      <img className="matter-image matter-source-detail" decoding="async" draggable="false" ref={sourceDetail} src="/assets/knowledge-matter-source.jpg" />
      <img className="matter-image matter-node" decoding="async" draggable="false" ref={node} src="/assets/knowledge-matter-node.jpg" />
      <img className="matter-image matter-node-detail" decoding="async" draggable="false" ref={nodeDetail} src="/assets/knowledge-matter-node.jpg" />
      <div className="matter-glow" ref={glow} />
      <div className="matter-grain" />
    </div>
  )
}

type HeaderProps = {
  active: number
  jumpTo: (index: number) => void
  menuOpen: boolean
  openSearch: () => void
  setMenuOpen: (open: boolean) => void
}

function Header({ active, jumpTo, menuOpen, openSearch, setMenuOpen }: HeaderProps) {
  return (
    <header className="spatial-nav">
      <a className="brand" href="#entry" onClick={(event) => { event.preventDefault(); jumpTo(0) }} aria-label="Fanisl 首页">
        <i aria-hidden="true" /><strong>fanisl</strong>
      </a>
      <nav aria-label="主要导航" className={menuOpen ? 'open' : ''}>
        <a aria-current={active < 5 ? 'page' : undefined} href="#entry" onClick={(event) => { event.preventDefault(); jumpTo(0); setMenuOpen(false) }}>首页</a>
        <a aria-current={active === 5 ? 'page' : undefined} href="#library" onClick={(event) => { event.preventDefault(); jumpTo(5); setMenuOpen(false) }}>知识库</a>
        <span aria-disabled="true">对话</span><span aria-disabled="true">评测台</span><span aria-disabled="true">档案</span>
      </nav>
      <div className="nav-actions">
        <button aria-label="搜索知识" className="search-trigger" onClick={openSearch} type="button"><span>⌕</span><em>搜索知识</em><kbd>⌘K</kbd></button>
        <button aria-expanded={menuOpen} aria-label={menuOpen ? '关闭导航' : '打开导航'} className="menu-trigger" onClick={() => setMenuOpen(!menuOpen)} type="button"><i /><i /></button>
      </div>
    </header>
  )
}

function SearchPanel({ close, jumpTo }: { close: () => void; jumpTo: (index: number) => void }) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => {
    const value = query.trim().toLowerCase()
    return value ? searchItems.filter((item) => `${item.kind} ${item.title}`.toLowerCase().includes(value)) : searchItems
  }, [query])

  return (
    <div className="search-backdrop" onMouseDown={close} role="presentation">
      <section aria-label="搜索当前知识样本" aria-modal="true" className="search-panel" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <div className="search-field">
          <span aria-hidden="true">⌕</span>
          <input aria-label="搜索当前知识样本" autoFocus onChange={(event) => setQuery(event.target.value)} placeholder="搜索认知、方法、判断或主题" value={query} />
          <kbd>ESC</kbd><button aria-label="关闭搜索" onClick={close} type="button">×</button>
        </div>
        <p>{query ? `${results.length} 个匹配样本` : '当前知识样本'}</p>
        {results.map((item) => (
          <button key={item.title} onClick={() => { jumpTo(item.chapter); close() }} type="button">
            <small>{item.kind}</small><strong>{item.title}</strong><span>↗</span>
          </button>
        ))}
        {results.length === 0 && <div className="no-result">当前样本中没有匹配内容</div>}
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
          <div><span>{chapter.description}</span>{index === 5 && <button onClick={openSearch} type="button">浏览当前知识样本 ↗</button>}</div>
        </section>
      ))}
    </main>
  )
}

function App() {
  const [active, setActive] = useState(0)
  const activeRef = useRef(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const progress = useRef(0)
  const targetProgress = useRef(0)
  const progressNumber = useRef<HTMLSpanElement>(null)
  const progressBar = useRef<HTMLSpanElement>(null)
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const compact = useMediaQuery('(max-width: 760px)')
  const [webGLAvailable] = useState(supportsWebGL)
  const staticExperience = reducedMotion || !webGLAvailable

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
      progress.current += difference * (1 - Math.exp(-delta * 5.2))
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
      if (event.key === 'Escape') { setSearchOpen(false); setMenuOpen(false) }
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
        <Header active={active} jumpTo={jumpTo} menuOpen={menuOpen} openSearch={openSearch} setMenuOpen={setMenuOpen} />
        <StaticJourney openSearch={openSearch} />
        {searchOpen && <SearchPanel close={() => setSearchOpen(false)} jumpTo={jumpTo} />}
      </div>
    )
  }

  return (
    <div className="spatial-experience">
      <div className="scroll-track" aria-hidden="true">
        {chapters.map((chapter) => <span className="scroll-marker" id={chapter.id} key={chapter.id} style={{ top: `${chapter.stop * 100}%` }} />)}
      </div>
      <div className="fixed-stage">
        <MaterialBackdrop progress={progress} />
        <div className="scene-canvas">
          <Suspense fallback={<div className="scene-loading"><span /></div>}><SpatialScene compact={compact} progress={progress} /></Suspense>
        </div>
        <div className="atmosphere" aria-hidden="true" />
        <Header active={active} jumpTo={jumpTo} menuOpen={menuOpen} openSearch={openSearch} setMenuOpen={setMenuOpen} />
        <aside aria-label="空间章节" className="chapter-rail">
          {chapters.map((chapter, index) => (
            <button aria-current={active === index ? 'step' : undefined} aria-label={`前往${chapter.label}`} key={chapter.id} onClick={() => jumpTo(index)} type="button">
              <i /><span>{chapter.index}</span><strong>{chapter.label}</strong>
            </button>
          ))}
        </aside>
        <div className="journey-hud" aria-hidden="true"><div><span>{chapters[active].index}</span><strong>{chapters[active].english}</strong></div><div className="progress-rule"><span ref={progressBar} /></div><span ref={progressNumber}>00%</span></div>
        <div className="scroll-cue" aria-hidden="true"><span>{active === 0 ? 'SCROLL TO ENTER' : active === 5 ? 'THE LIBRARY, AS IT IS' : 'MOVE DEEPER'}</span><i /></div>
      </div>
      {searchOpen && <SearchPanel close={() => setSearchOpen(false)} jumpTo={jumpTo} />}
    </div>
  )
}

export default App
