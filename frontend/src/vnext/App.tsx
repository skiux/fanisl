import { useEffect, useState } from 'react'
import {
  ArrowsClockwise, Binoculars, ChartLine, ChatCircle, Flask, Gauge, MagnifyingGlass,
  ShieldCheck, SidebarSimple,
} from '@phosphor-icons/react'
import Desk from './pages/Desk'
import { api } from './api'
import { navigate, useRoute } from './router'
import { useResource } from './useResource'

const AREAS = [
  { key: 'desk', label: 'Desk', caption: '今日研究', icon: Gauge },
  { key: 'investigate', label: 'Investigate', caption: '调查知识', icon: Binoculars },
  { key: 'verify', label: 'Verify', caption: '验证判断', icon: ShieldCheck },
  { key: 'markets', label: 'Markets', caption: '市场证据', icon: ChartLine },
  { key: 'experiments', label: 'Experiments', caption: '实验评测', icon: Flask },
  { key: 'copilot', label: 'Copilot', caption: '研究协作', icon: ChatCircle },
] as const

const UPCOMING: Record<string, { title: string; mission: string; inputs: string[] }> = {
  investigate: { title: 'Investigate', mission: '从工作结论进入支持、反对和原始证据，而不是浏览节点表。', inputs: ['Knowledge Node', 'Claim / Method / Concept', 'L0 Content', 'Creator history'] },
  verify: { title: 'Verify', mission: '把一次市场裁决解释为完整、可复核的证据对象。', inputs: ['Verification queue', 'Frozen scoring rule', 'Price path', 'Knowledge impact'] },
  markets: { title: 'Markets', mission: '先显示数据覆盖与异常，再显示价格、指标和催化剂。', inputs: ['Metric catalog', 'Coverage', 'Time series', 'Catalysts'] },
  experiments: { title: 'Experiments', mission: '按研究假设比较先验、live 表现、否决与交易证据。', inputs: ['Setup registry', 'Signals', 'Accounts', 'Trades / Declines'] },
  copilot: { title: 'Copilot', mission: '让对话引用可打开的市场、知识和验证对象。', inputs: ['Streaming chat', 'Tool status', 'Conversations', 'Evidence links'] },
}

function Upcoming({ area }: { area: string }) {
  const item = UPCOMING[area] ?? UPCOMING.investigate
  return <main className="fn-upcoming">
    <p className="fn-kicker">Rebuild sequence</p>
    <h1>{item.title}</h1>
    <p className="fn-upcoming__mission">{item.mission}</p>
    <div className="fn-upcoming__rule" />
    <p className="fn-label">下一阶段的数据输入</p>
    <div className="fn-upcoming__inputs">{item.inputs.map((input, index) => <div key={input}><span>0{index + 1}</span>{input}</div>)}</div>
    <p className="fn-upcoming__note">该工作流尚未进入实现。本阶段不回退到旧页面，也不显示伪完成的数据列表。</p>
  </main>
}

export default function App() {
  const route = useRoute()
  const health = useResource(api.health, [], 30000)
  const [compact, setCompact] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        document.getElementById('fn-global-search')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return <div className={`fn-app ${compact ? 'fn-app--compact' : ''}`}>
    <aside className="fn-rail">
      <div className="fn-brand"><span className="fn-brand__mark">F</span><span className="fn-brand__text"><b>FANISL</b><small>RESEARCH OS</small></span></div>
      <nav className="fn-nav" aria-label="研究工作流">{AREAS.map((item, index) => {
        const Icon = item.icon
        const active = route.area === item.key
        return <button key={item.key} className={active ? 'is-active' : ''} onClick={() => navigate(`/${item.key}`)}><span className="fn-nav__index">0{index + 1}</span><Icon size={18} weight={active ? 'fill' : 'regular'} /><span><b>{item.label}</b><small>{item.caption}</small></span></button>
      })}</nav>
      <div className="fn-rail__footer"><button onClick={() => setCompact((value) => !value)} title="切换导航宽度"><SidebarSimple size={17} /><span>COLLAPSE</span></button><p>Local single-user<br />Evidence system</p></div>
    </aside>

    <section className="fn-stage">
      <header className="fn-topbar">
        <div className="fn-terminal-state"><span className={`fn-led ${health.data?.status === 'ok' ? 'is-ok' : health.error ? 'is-error' : ''}`} /><b>{health.data?.status === 'ok' ? 'SYSTEM ONLINE' : health.error ? 'SYSTEM DEGRADED' : 'CONNECTING'}</b><span>{health.data?.model ?? 'checking backend'}</span></div>
        <label className="fn-search"><MagnifyingGlass size={16} /><input id="fn-global-search" placeholder="Search evidence, claims, symbols..." aria-label="全局搜索" /><kbd>⌘K</kbd></label>
        <div className="fn-clock"><span>{new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium' }).format(new Date()).toUpperCase()}</span><button onClick={health.reload} title="刷新系统状态"><ArrowsClockwise size={16} /></button></div>
      </header>
      <div className="fn-workspace">{route.area === 'desk' ? <Desk /> : <Upcoming area={route.area} />}</div>
    </section>
  </div>
}
