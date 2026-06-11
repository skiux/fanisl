import { useState, type ReactNode } from 'react'
import { ChartLineUp, ChatCircle, Pulse, Strategy } from '@phosphor-icons/react'
import PriceTicker from './components/PriceTicker'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import { useConversations } from './useConversations'
import DataExplorer from './market/pages/DataExplorer'
import Categories from './market/pages/Categories'
import Trading from './market/pages/Trading'

// 数据分类页（分类显示数据总览中的数据）
const DATA_CATS: { key: string; label: string; sub: string; symbol: string }[] = [
  { key: 'technical', label: '技术', sub: '逐周期 · 趋势 / 动量 / 波动 / 量', symbol: 'BTC/USDT' },
  { key: 'derivatives', label: '衍生品', sub: '资金费 / OI / 多空比 / 期权 / 爆仓', symbol: 'BTC/USDT' },
  { key: 'microstructure', label: '盘口', sub: '价差 / 深度 / 失衡', symbol: 'BTC/USDT' },
  { key: 'onchain', label: '链上', sub: '稳定币 / TVL / 网络使用度', symbol: 'BTC/USDT' },
  { key: 'sentiment', label: '情绪', sub: '恐惧贪婪 / 社交', symbol: 'GLOBAL' },
  { key: 'macro', label: '宏观', sub: '通胀 / 就业 / 利率 / 流动性', symbol: 'GLOBAL' },
]

type View = 'chat' | 'data' | 'trading' | string

const NAV: { key: View; label: string; icon?: ReactNode }[] = [
  { key: 'chat', label: '对话', icon: <ChatCircle size={15} weight="bold" /> },
  { key: 'data', label: '数据总览', icon: <ChartLineUp size={15} weight="bold" /> },
  ...DATA_CATS.map((c) => ({ key: c.key, label: c.label })),
  { key: 'trading', label: '交易评测', icon: <Strategy size={15} weight="bold" /> },
]

export default function App() {
  const { conversations, refresh } = useConversations()
  const [activeId, setActiveId] = useState<number | null>(null)
  const [view, setView] = useState<View>('chat')
  const cat = DATA_CATS.find((c) => c.key === view)

  return (
    <div className="flex h-full flex-col bg-zinc-50 text-zinc-900">
      <header className="flex items-center gap-4 border-b border-zinc-200/80 bg-white px-4 py-2">
        <div className="flex shrink-0 items-center gap-2">
          <div className="grid h-6 w-6 place-items-center rounded-md bg-zinc-900 text-[12px] font-bold text-emerald-400">f</div>
          <span className="text-[14px] font-semibold tracking-tight">fanisl</span>
        </div>
        <nav className="flex flex-1 items-center gap-0.5 overflow-x-auto">
          {NAV.map((n) => {
            const on = view === n.key
            return (
              <button
                key={n.key}
                onClick={() => setView(n.key)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors active:translate-y-px ${
                  on ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'
                }`}
              >
                {n.icon && <span className={on ? 'text-emerald-400' : ''}>{n.icon}</span>}
                {n.label}
              </button>
            )
          })}
        </nav>
        <span className="hidden shrink-0 items-center gap-1.5 text-[11px] text-zinc-400 sm:flex">
          <Pulse size={13} weight="bold" className="text-emerald-500" /> 仅盘面解读，非投资建议
        </span>
      </header>

      {/* 对话视图常驻挂载、切换仅改可见性，避免丢消息 */}
      <div className="flex min-h-0 flex-1">
        <div className={view === 'chat' ? 'flex min-w-0 flex-1' : 'hidden'}>
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

        <div className={view === 'chat' ? 'hidden' : 'flex min-w-0 flex-1 overflow-hidden'}>
          {view === 'data' && <DataExplorer />}
          {view === 'trading' && <Trading />}
          {cat && (
            <Categories
              key={cat.key}
              category={cat.key}
              title={cat.label === '技术' ? '技术面' : cat.label}
              sub={cat.sub}
              defaultSymbol={cat.symbol}
            />
          )}
        </div>
      </div>
    </div>
  )
}
