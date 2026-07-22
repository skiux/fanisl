import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'

const SpatialScene = lazy(() => import('./SpatialScene'))

const chapters = [
  { id: 'entry', index: '00', label: '入口', english: 'ENTER', stop: 0 },
  { id: 'source', index: '01', label: '内容', english: 'CONTENT', stop: 0.14 },
  { id: 'units', index: '02', label: '单元', english: 'EXTRACT', stop: 0.32 },
  { id: 'node', index: '03', label: '节点', english: 'MERGE', stop: 0.5 },
  { id: 'relations', index: '04', label: '关系', english: 'DISCOVER', stop: 0.69 },
  { id: 'library', index: '05', label: '知识库', english: 'REMEMBER', stop: 0.87 },
] as const

const searchItems = [
  { kind: '认知', title: 'AI 时代的软件收费：席位 → 按量 → 按结果', chapter: 3 },
  { kind: '方法', title: 'EMA 隧道：用多周期结构识别趋势与防守位', chapter: 2 },
  { kind: '判断', title: '标普 500 2026 年底 8200 点', chapter: 2 },
  { kind: '发现', title: '半导体“数字地租”与传统周期解释的分歧', chapter: 4 },
] as const

function getActiveChapter(progress: number) {
  let active = 0
  chapters.forEach((chapter, index) => {
    if (progress >= chapter.stop) active = index
  })
  return active
}

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
      <a
        aria-label="Fanisl 首页"
        className="brand"
        href="#entry"
        onClick={(event) => {
          event.preventDefault()
          jumpTo(0)
        }}
      >
        <i aria-hidden="true" />
        <strong>fanisl</strong>
      </a>

      <nav aria-label="主要导航" className={menuOpen ? 'open' : ''}>
        <a
          aria-current={active < 5 ? 'page' : undefined}
          href="#entry"
          onClick={(event) => {
            event.preventDefault()
            jumpTo(0)
            setMenuOpen(false)
          }}
        >首页</a>
        <a
          aria-current={active === 5 ? 'page' : undefined}
          href="#library"
          onClick={(event) => {
            event.preventDefault()
            jumpTo(5)
            setMenuOpen(false)
          }}
        >知识库</a>
        <span aria-disabled="true">对话</span>
        <span aria-disabled="true">评测台</span>
        <span aria-disabled="true">档案</span>
      </nav>

      <div className="nav-actions">
        <button aria-label="搜索知识" className="search-trigger" onClick={openSearch} type="button">
          <span aria-hidden="true">⌕</span>
          <em>搜索知识</em>
          <kbd>⌘K</kbd>
        </button>
        <button
          aria-expanded={menuOpen}
          aria-label={menuOpen ? '关闭导航' : '打开导航'}
          className="menu-trigger"
          onClick={() => setMenuOpen(!menuOpen)}
          type="button"
        >
          <i /><i />
        </button>
      </div>
    </header>
  )
}

function SearchPanel({ close, jumpTo }: { close: () => void; jumpTo: (index: number) => void }) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => {
    const value = query.trim().toLowerCase()
    return value
      ? searchItems.filter((item) => `${item.kind} ${item.title}`.toLowerCase().includes(value))
      : searchItems
  }, [query])

  return (
    <div className="search-backdrop" onMouseDown={close} role="presentation">
      <section
        aria-label="搜索当前知识样本"
        aria-modal="true"
        className="search-panel"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="搜索当前知识样本"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索认知、方法、判断或主题"
            value={query}
          />
          <kbd>ESC</kbd>
          <button aria-label="关闭搜索" onClick={close} type="button">×</button>
        </div>
        <p>{query ? `${results.length} 个匹配样本` : '当前知识样本'}</p>
        {results.map((item) => (
          <button
            key={item.title}
            onClick={() => {
              jumpTo(item.chapter)
              close()
            }}
            type="button"
          >
            <small>{item.kind}</small><strong>{item.title}</strong><span>↗</span>
          </button>
        ))}
        {results.length === 0 && <div className="no-result">当前样本中没有匹配内容</div>}
      </section>
    </div>
  )
}

type ChapterContentProps = {
  index: number
  openSearch: () => void
  proceed: () => void
}

function ChapterContent({ index, openSearch, proceed }: ChapterContentProps) {
  if (index === 0) {
    return (
      <div className="chapter-content hero-content">
        <p className="scene-eyebrow"><span>FANISL</span> · PERSONAL INVESTMENT KNOWLEDGE ENGINE</p>
        <h1>把分散的投资内容，<br /><em>沉淀成自己的知识。</em></h1>
        <p className="scene-summary">从公开内容出发，保存原文，拆出判断、方法与认知，再让它们归并、演进、彼此连接。向里走，看到一条内容如何成为长期知识。</p>
        <div className="hero-actions">
          <button className="primary-action" onClick={proceed} type="button">向内探索 <span>↓</span></button>
          <button className="quiet-action" onClick={openSearch} type="button">搜索当前知识样本</button>
        </div>
        <div aria-label="当前知识库规模" className="hero-ledger">
          <div><strong>18</strong><span>篇内容</span></div>
          <div><strong>247</strong><span>个知识单元</span></div>
          <div><strong>105</strong><span>个知识节点</span></div>
        </div>
      </div>
    )
  }

  if (index === 1) {
    return (
      <div className="chapter-content source-content">
        <p className="scene-eyebrow">01 · CONTENT / L0</p>
        <h2>所有知识，先有一段<br />可以返回的原文。</h2>
        <p className="scene-summary">转录、画面信息、发布时间与信源被完整保留。后面的任何提取、归并和判断，都可以沿路径退回原话。</p>
        <article className="evidence-card">
          <header><span>CONTENT 018</span><small>16:42</small></header>
          <strong>AI 竟与百年前的电力革命如此相似</strong>
          <blockquote>“真正改变生产率的，不是基础设施建成的那一天，而是组织方式开始随之变化。”</blockquote>
          <footer><span>逐字转录 13,657</span><span>画面笔记 12</span></footer>
        </article>
      </div>
    )
  }

  if (index === 2) {
    return (
      <div className="chapter-content units-content">
        <p className="scene-eyebrow">02 · EXTRACT / L1</p>
        <h2>一篇内容被拆开，<br />三种知识各自留下。</h2>
        <p className="scene-summary">判断、方法与认知不是同一种对象，也没有主次之分。它们带着逐字引文和出处，进入各自适合的长期结构。</p>
        <div className="unit-ledger">
          <article className="claim"><span>01 · CLAIM</span><strong>判断</strong><b>135</b><small>带时点的市场主张</small></article>
          <article className="method"><span>02 · METHOD</span><strong>方法</strong><b>23</b><small>可以复述与测试的规则</small></article>
          <article className="concept"><span>03 · CONCEPT</span><strong>认知</strong><b>89</b><small>可以反复调用的理解</small></article>
        </div>
      </div>
    )
  }

  if (index === 3) {
    return (
      <div className="chapter-content node-content">
        <p className="scene-eyebrow">03 · MERGE / MEMORY</p>
        <h2>重复不是堆积，<br />新的表达会回到同一节点。</h2>
        <p className="scene-summary">相同命题被归并为规范节点。新的重申、细化、修正和反驳不会覆盖旧内容，而是成为一条可回看的知识时间线。</p>
        <article className="node-card">
          <header><span>NODE 005 · 认知</span><small>CURRENT CANONICAL</small></header>
          <p>软件定价从席位制，经过按量收费，<strong>最终转向按结果收费。</strong></p>
          <div className="node-history">
            <span><i />05.31 首次提及</span>
            <b>supersedes</b>
            <span><i />06.21 修正取代</span>
          </div>
        </article>
      </div>
    )
  }

  if (index === 4) {
    return (
      <div className="chapter-content relations-content">
        <p className="scene-eyebrow">04 · DISCOVER / RELATIONS</p>
        <h2>当知识彼此连接，<br />研究才真正开始。</h2>
        <p className="scene-summary">节点不再只是独立摘要。对立暴露分歧，互补补足解释，跨源共识显示一条理解正在形成。</p>
        <div className="relation-ledger">
          <article><span className="relation-dot opposition" /><strong>对立</strong><small>找到不能同时成立的解释</small><b>1</b></article>
          <article><span className="relation-dot complement" /><strong>互补</strong><small>拼合不同尺度的知识</small><b>5</b></article>
          <article><span className="relation-dot consensus" /><strong>共识</strong><small>观察跨信源的共同结构</small><b>持续发现</b></article>
        </div>
      </div>
    )
  }

  return (
    <div className="chapter-content library-content">
      <p className="scene-eyebrow">05 · REMEMBER / THE LIBRARY</p>
      <h2>抵达的不是终点，<br /><em>而是一座会继续生长的知识库。</em></h2>
      <p className="scene-summary">它从 2 位信源和 18 篇内容开始。规模仍小，但每一次新增都进入同一套证据、归并、演进与发现结构。</p>
      <div className="library-stats">
        <div><strong>2</strong><span>信源</span></div>
        <div><strong>18</strong><span>内容</span></div>
        <div><strong>247</strong><span>单元</span></div>
        <div><strong>105</strong><span>节点</span></div>
      </div>
      <div className="library-actions">
        <button className="primary-action" onClick={openSearch} type="button">浏览当前知识样本 <span>↗</span></button>
        <span>原文证据 · 时点版本 · 演进关系 · 选择性验证</span>
      </div>
    </div>
  )
}

function ReducedExperience({ jumpTo, openSearch }: { jumpTo: (index: number) => void; openSearch: () => void }) {
  return (
    <main className="reduced-main">
      {chapters.map((chapter, index) => (
        <section className={`reduced-chapter reduced-${chapter.id}`} id={chapter.id} key={chapter.id}>
          <div className="reduced-depth" aria-hidden="true"><span>{chapter.index}</span><i /><i /></div>
          <ChapterContent index={index} openSearch={openSearch} proceed={() => jumpTo(Math.min(index + 1, chapters.length - 1))} />
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
  const compactDevice = useMediaQuery('(max-width: 760px)')
  const [webGLAvailable] = useState(supportsWebGL)
  const staticExperience = reducedMotion || !webGLAvailable

  const jumpTo = useCallback((index: number) => {
    if (staticExperience) {
      document.getElementById(chapters[index].id)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' })
      return
    }
    const maximum = document.documentElement.scrollHeight - window.innerHeight
    window.scrollTo({ behavior: reducedMotion ? 'auto' : 'smooth', top: chapters[index].stop * maximum })
  }, [reducedMotion, staticExperience])

  useEffect(() => {
    if (staticExperience) return
    let frame = 0

    const readScroll = () => {
      const maximum = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
      targetProgress.current = MathUtilsClamp(window.scrollY / maximum)
    }

    const update = () => {
      const difference = targetProgress.current - progress.current
      progress.current += difference * 0.13
      if (Math.abs(difference) < 0.0001) progress.current = targetProgress.current

      const nextActive = getActiveChapter(progress.current)
      if (nextActive !== activeRef.current) {
        activeRef.current = nextActive
        setActive(nextActive)
      }
      document.documentElement.style.setProperty('--journey-progress', progress.current.toFixed(4))
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
      document.documentElement.style.removeProperty('--journey-progress')
    }
  }, [staticExperience])

  useEffect(() => {
    if (!staticExperience) return
    const sections = chapters
      .map((chapter) => document.getElementById(chapter.id))
      .filter((section): section is HTMLElement => Boolean(section))
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
      if (!visible) return
      const nextActive = chapters.findIndex((chapter) => chapter.id === visible.target.id)
      if (nextActive < 0 || nextActive === activeRef.current) return
      activeRef.current = nextActive
      setActive(nextActive)
    }, { rootMargin: '-25% 0px -45%', threshold: [0.2, 0.45, 0.7] })
    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [staticExperience])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
      if (event.key === 'Escape') {
        setSearchOpen(false)
        setMenuOpen(false)
      }
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
      <div className="reduced-shell">
        <Header active={active} jumpTo={jumpTo} menuOpen={menuOpen} openSearch={openSearch} setMenuOpen={setMenuOpen} />
        <ReducedExperience jumpTo={jumpTo} openSearch={openSearch} />
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
        <div className="scene-canvas" aria-hidden="true">
          <Suspense fallback={<div className="webgl-fallback is-loading" />}>
            <SpatialScene progress={progress} reducedDensity={compactDevice} />
          </Suspense>
        </div>
        <div className="atmosphere" aria-hidden="true" />

        <Header active={active} jumpTo={jumpTo} menuOpen={menuOpen} openSearch={openSearch} setMenuOpen={setMenuOpen} />

        <main className={`scene-copy scene-${chapters[active].id}`}>
          <section className="chapter-layer" key={chapters[active].id}>
            <ChapterContent index={active} openSearch={openSearch} proceed={() => jumpTo(Math.min(active + 1, chapters.length - 1))} />
          </section>
        </main>

        <aside aria-label="空间章节" className="chapter-rail">
          {chapters.map((chapter, index) => (
            <button
              aria-current={active === index ? 'step' : undefined}
              aria-label={`前往${chapter.label}`}
              key={chapter.id}
              onClick={() => jumpTo(index)}
              type="button"
            >
              <i /><span>{chapter.index}</span><strong>{chapter.label}</strong>
            </button>
          ))}
        </aside>

        <div className="journey-hud" aria-hidden="true">
          <div><span>{chapters[active].index}</span><strong>{chapters[active].english}</strong></div>
          <div className="progress-rule"><span ref={progressBar} /></div>
          <span ref={progressNumber}>00%</span>
        </div>

        <div className={`scroll-cue ${active === chapters.length - 1 ? 'is-finished' : ''}`} aria-hidden="true">
          <span>{active === 0 ? 'SCROLL TO ENTER' : active === chapters.length - 1 ? 'THE LIBRARY, AS IT IS' : 'KEEP MOVING INWARD'}</span>
          <i />
        </div>
      </div>

      {searchOpen && <SearchPanel close={() => setSearchOpen(false)} jumpTo={jumpTo} />}
    </div>
  )
}

function MathUtilsClamp(value: number) {
  return Math.min(1, Math.max(0, value))
}

export default App
