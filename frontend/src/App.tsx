import { useEffect, useState } from 'react'
import { Books, ChartLineUp, ChatCircle, Flask, MagnifyingGlass, Pulse, Sun } from '@phosphor-icons/react'
import PriceTicker from './components/PriceTicker'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import CommandPalette from './components/CommandPalette'
import { useConversations } from './useConversations'
import { navigate, useRoute } from './lib/router'
import Today from './market/pages/Today'
import Knowledge from './market/pages/Knowledge'
import MarketData from './market/pages/MarketData'
import Research from './market/pages/Research'

// 顶层导航（PRODUCT.md §1）：四空间 + 对话工具，顺序即优先级，默认落点=今日。
const NAV = [
  { key: 'today', label: '今日', icon: Sun },
  { key: 'knowledge', label: '知识库', icon: Books },
  { key: 'data', label: '市场数据', icon: ChartLineUp },
  { key: 'research', label: '研究', icon: Flask },
  { key: 'chat', label: '对话', icon: ChatCircle },
] as const

export default function App() {
  const route = useRoute()
  const space = route.path[0] ?? 'today'
  const { conversations, refresh } = useConversations()
  const [activeId, setActiveId] = useState<number | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // ⌘K / Ctrl+K：全局对象寻址（DESIGN.md §15.3 冻结键位）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-full flex-col bg-zinc-50 text-zinc-900">
      <header className="flex items-center gap-4 border-b border-zinc-200 bg-white px-4 py-2">
        <div className="flex shrink-0 items-center gap-2">
          <div className="grid h-6 w-6 place-items-center rounded-md bg-zinc-900 text-xs font-bold text-emerald-400">f</div>
          <span className="text-base font-semibold tracking-tight">fanisl</span>
        </div>
        <nav className="flex flex-1 items-center gap-0.5 overflow-x-auto">
          {NAV.map((n) => {
            const on = space === n.key
            const Icon = n.icon
            return (
              <button key={n.key} onClick={() => navigate(`/${n.key}`)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors duration-150 active:translate-y-px ${
                  on ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'
                }`}>
                <Icon size={15} weight="bold" className={on ? 'text-emerald-400' : ''} />
                {n.label}
              </button>
            )
          })}
        </nav>
        <button onClick={() => setPaletteOpen(true)} title="全局寻址"
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-2 py-1 text-2xs text-zinc-400 transition-colors duration-150 hover:bg-zinc-50 hover:text-zinc-600">
          <MagnifyingGlass size={12} /> <kbd className="font-mono">⌘K</kbd>
        </button>
        <span className="hidden shrink-0 items-center gap-1.5 text-2xs text-zinc-400 sm:flex">
          <Pulse size={13} weight="bold" className="text-accent" /> 仅盘面解读，非投资建议
        </span>
      </header>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {/* 对话视图常驻挂载、切换仅改可见性，避免丢消息 */}
      <div className="flex min-h-0 flex-1">
        <div className={space === 'chat' ? 'flex min-w-0 flex-1' : 'hidden'}>
          <Sidebar
            conversations={conversations}
            activeId={activeId}
            onNew={() => setActiveId(null)}
            onSelect={setActiveId}
            onDeleted={(id) => {
              if (id === activeId) setActiveId(null)
              refresh()
            }}
            onRenamed={refresh}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <PriceTicker />
            <ChatView
              conversationId={activeId}
              onCreated={(id) => {
                setActiveId(id)
                refresh()
              }}
              onActivity={refresh}
            />
          </div>
        </div>

        <div className={space === 'chat' ? 'hidden' : 'flex min-w-0 flex-1 overflow-hidden'}>
          {space === 'today' && <Today />}
          {space === 'knowledge' && <Knowledge route={route} />}
          {space === 'data' && <MarketData route={route} />}
          {space === 'research' && <Research route={route} />}
        </div>
      </div>
    </div>
  )
}
