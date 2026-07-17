import { useEffect, useMemo, useRef, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import {
  fetchCatalog, fetchKnowledgeContents, fetchKnowledgeCreators, fetchKnowledgeTags,
  fetchKnowledgeUnitsBrowse,
} from '../api'
import { navigate } from '../lib/router'
import { unitHeadline } from '../market/knowledgeUnits'

// ⌘K 对象寻址（DESIGN.md §15.3；Bloomberg 的"命令直达"借法）。
// 检索域：导航 / 信源 / 标签 / 内容标题 / 指标 / 知识单元全文（后端 ILIKE）。
// Overlay 是全站唯一允许阴影的层（§5.1）。

interface Item {
  group: string
  label: string
  sub?: string
  to: string
}

const NAV_ITEMS: Item[] = [
  { group: '导航', label: '今日', to: '/today' },
  { group: '导航', label: '知识库', to: '/knowledge' },
  { group: '导航', label: '知识库 · 判断', to: '/knowledge/browse?kind=claim' },
  { group: '导航', label: '知识库 · 方法', to: '/knowledge/browse?kind=method' },
  { group: '导航', label: '知识库 · 认知', to: '/knowledge/browse?kind=concept' },
  { group: '导航', label: '知识库 · 标签', to: '/knowledge/tags' },
  { group: '导航', label: '市场数据', to: '/data' },
  { group: '导航', label: '研究', to: '/research' },
  { group: '导航', label: '研究档案（23 裁决）', to: '/research/archive' },
  { group: '导航', label: '对话', to: '/chat' },
]

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [statics, setStatics] = useState<Item[]>([])
  const [unitItems, setUnitItems] = useState<Item[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // 打开时拉一次静态索引（信源/标签/内容/指标）
  useEffect(() => {
    if (!open) return
    setQ('')
    setSel(0)
    setUnitItems([])
    setTimeout(() => inputRef.current?.focus(), 0)
    Promise.allSettled([
      fetchKnowledgeCreators(), fetchKnowledgeTags(), fetchKnowledgeContents(), fetchCatalog(),
    ]).then(([cr, tg, ct, cat]) => {
      const items: Item[] = []
      if (cr.status === 'fulfilled') {
        for (const c of cr.value) items.push({ group: '信源', label: c.name, to: `/knowledge?creator=${c.id}` })
      }
      if (tg.status === 'fulfilled') {
        for (const t of tg.value) items.push({
          group: '标签', label: t.tag, sub: `${t.n} 单元`,
          to: `/knowledge/browse?tag=${encodeURIComponent(t.tag)}`,
        })
      }
      if (ct.status === 'fulfilled') {
        for (const c of ct.value) items.push({
          group: '内容', label: c.title ?? `内容 #${c.id}`, sub: c.creator,
          to: `/knowledge/content/${c.id}`,
        })
      }
      if (cat.status === 'fulfilled') {
        for (const m of cat.value.metrics) items.push({
          group: '指标', label: m.label, sub: m.name,
          to: `/data?metric=${encodeURIComponent(m.name)}`,
        })
      }
      setStatics(items)
    })
  }, [open])

  // 路由变化（包括浏览器前进后退）时自动关闭
  useEffect(() => {
    if (!open) return
    window.addEventListener('hashchange', onClose)
    return () => window.removeEventListener('hashchange', onClose)
  }, [open, onClose])

  // 单元全文检索（防抖 250ms）
  useEffect(() => {
    if (!open) return
    const query = q.trim()
    if (query.length < 2) {
      setUnitItems([])
      return
    }
    const id = setTimeout(() => {
      fetchKnowledgeUnitsBrowse({ q: query, limit: 8 })
        .then((us) => setUnitItems(us.map((u: any) => ({
          group: '单元', label: unitHeadline(u),
          sub: `${u.creator} · ${u.quote.slice(0, 40)}…`,
          to: `/knowledge/unit/${u.id}`,
        }))))
        .catch(() => setUnitItems([]))
    }, 250)
    return () => clearTimeout(id)
  }, [q, open])

  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    const match = (it: Item) =>
      !query || it.label.toLowerCase().includes(query) || (it.sub ?? '').toLowerCase().includes(query)
    const cap = (arr: Item[], n: number) => arr.slice(0, n)
    const grouped: Item[] = [
      ...cap(NAV_ITEMS.filter(match), 4),
      ...cap(statics.filter((s) => s.group === '信源').filter(match), 3),
      ...cap(statics.filter((s) => s.group === '标签').filter(match), 4),
      ...cap(statics.filter((s) => s.group === '内容').filter(match), 4),
      ...cap(unitItems, 6),
      ...cap(statics.filter((s) => s.group === '指标').filter(match), query ? 4 : 0),
    ]
    return grouped
  }, [q, statics, unitItems])

  useEffect(() => setSel(0), [results.length, q])

  if (!open) return null

  const go = (it: Item) => {
    navigate(it.to)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-zinc-900/20" onClick={onClose}>
      <div className="mx-auto mt-[14vh] w-[560px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-zinc-100 px-4">
          <MagnifyingGlass size={15} className="text-zinc-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
              else if (e.key === 'Enter' && results[sel]) go(results[sel])
              else if (e.key === 'Escape') onClose()
            }}
            placeholder="寻址：信源 / 标签 / 内容 / 单元全文 / 指标…"
            className="w-full bg-transparent py-3 text-md text-zinc-900 outline-none placeholder:text-zinc-300"
          />
          <kbd className="shrink-0 rounded border border-zinc-200 px-1.5 py-0.5 font-mono text-2xs text-zinc-400">esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-sm text-zinc-400">
              {q.trim().length >= 2 ? '没有匹配对象。' : '输入以检索；单元全文需 ≥2 字。'}
            </p>
          ) : (
            results.map((it, i) => {
              const showGroup = i === 0 || results[i - 1].group !== it.group
              return (
                <div key={`${it.group}-${it.to}-${i}`}>
                  {showGroup && (
                    <div className="px-4 pb-1 pt-2.5 text-2xs font-medium uppercase tracking-[0.14em] text-zinc-300">
                      {it.group}
                    </div>
                  )}
                  <button
                    onMouseEnter={() => setSel(i)}
                    onClick={() => go(it)}
                    className={`flex w-full items-baseline gap-2.5 px-4 py-1.5 text-left ${i === sel ? 'bg-zinc-100' : ''}`}>
                    <span className="min-w-0 truncate text-sm text-zinc-800">{it.label}</span>
                    {it.sub && <span className="min-w-0 shrink truncate text-2xs text-zinc-400">{it.sub}</span>}
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
