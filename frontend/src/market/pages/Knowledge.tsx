import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowSquareOut, Books, CaretLeft, CaretRight, UsersThree, VideoCamera } from '@phosphor-icons/react'
import { fetchKnowledgeContent, fetchKnowledgeContents, fetchKnowledgeCreators } from '../../api'
import { Badge, EmptyState, Kpi, KpiRow, PageShell, Panel } from '../ui'
import { when } from '../trading'

const STATUS: Record<string, { label: string; tone: 'neutral' | 'accent' | 'high' }> = {
  new: { label: '新入库', tone: 'neutral' },
  triaged: { label: '已分诊', tone: 'neutral' },
  awaiting_manual: { label: '待提取', tone: 'high' },
  extracted: { label: '已提取', tone: 'accent' },
  skipped: { label: '跳过', tone: 'neutral' },
}

// L0 raw = 转录正文 + "## 视觉笔记" 列表（llm.render_l0_text 的格式约定）
function splitRaw(raw: string): { transcript: string; notes: { t: string; kind: string; note: string }[] } {
  const [body, notesPart] = raw.split(/\n## 视觉笔记[^\n]*\n?/)
  const notes = (notesPart ?? '')
    .split('\n')
    .map((l) => l.match(/^- \[(.+?)\] \((.+?)\) (.*)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ t: m[1], kind: m[2], note: m[3] }))
  return { transcript: (body ?? '').trim(), notes }
}

// 知识引擎页：信源 + L0 内容库（转录/视觉笔记预览）。提取/评分视图随 K3/K4 加。
export default function Knowledge() {
  const [creators, setCreators] = useState<any[]>([])
  const [contents, setContents] = useState<any[]>([])
  const [detail, setDetail] = useState<any | null>(null)

  const refresh = useCallback(() => {
    fetchKnowledgeCreators().then(setCreators).catch(() => {})
    fetchKnowledgeContents().then(setContents).catch(() => {})
  }, [])
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 30000)
    return () => clearInterval(id)
  }, [refresh])

  const stats = useMemo(() => {
    const by = (s: string) => contents.filter((c) => c.status === s).length
    return {
      total: contents.length,
      chars: contents.reduce((a, c) => a + (c.raw_len ?? 0), 0),
      pending: by('new') + by('triaged') + by('awaiting_manual'),
      extracted: by('extracted'),
    }
  }, [contents])

  if (detail) {
    const { transcript, notes } = splitRaw(detail.raw ?? '')
    const st = STATUS[detail.status] ?? { label: detail.status, tone: 'neutral' as const }
    return (
      <PageShell
        title={detail.title ?? `内容 #${detail.id}`}
        sub={`${detail.creator} · ${detail.platform} · 发布 ${when(detail.published_at)} · ${detail.lang ?? '?'} · ${(detail.raw ?? '').length.toLocaleString()} 字`}
        controls={
          <div className="flex items-center gap-2">
            <button onClick={() => setDetail(null)}
              className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 active:translate-y-px">
              <CaretLeft size={13} weight="bold" /> 返回列表
            </button>
            {detail.url && (
              <a href={detail.url} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100">
                <ArrowSquareOut size={13} weight="bold" /> 原视频
              </a>
            )}
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          <Panel className="lg:col-span-3" title="转录全文（Gemini URL 直读）">
            <div className="max-h-[70vh] overflow-y-auto whitespace-pre-wrap text-[13.5px] leading-relaxed text-zinc-700">
              {transcript || <EmptyState title="无转录正文" />}
            </div>
          </Panel>
          <Panel className="lg:col-span-2" title={`视觉笔记 · ${notes.length}（画面信息，带时间戳）`}>
            {notes.length === 0 ? (
              <EmptyState title="无视觉笔记" />
            ) : (
              <ul className="max-h-[70vh] space-y-2 overflow-y-auto">
                {notes.map((n, i) => (
                  <li key={i} className="text-[12.5px] leading-relaxed">
                    <span className="mr-1.5 inline-block rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[11px] text-emerald-400">{n.t}</span>
                    <span className="mr-1.5 text-[11px] uppercase tracking-wide text-zinc-400">{n.kind}</span>
                    <span className="text-zinc-700">{n.note}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell
      title="知识引擎"
      sub="获取并审计金融创作者的知识 · L0 原文库（转录+视觉笔记）· 提取/评分随 K3/K4 上线"
    >
      <KpiRow cols={4}>
        <Kpi label="信源" value={String(creators.length)} />
        <Kpi label="内容" value={String(stats.total)} sub={`${(stats.chars / 1000).toFixed(1)}k 字`} />
        <Kpi label="待提取" value={String(stats.pending)} tone={stats.pending > 0 ? 'up' : 'neutral'} />
        <Kpi label="已提取" value={String(stats.extracted)} />
      </KpiRow>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-5">
        <Panel className="lg:col-span-2"
          title={<span className="flex items-center gap-1.5"><UsersThree size={15} weight="bold" className="text-emerald-600" />信源 · {creators.length}</span>}>
          {creators.length === 0 ? (
            <EmptyState title="还没有登记信源" hint="python -m analyzer.knowledge.register <名称> <平台> <handle>" />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {creators.map((c) => (
                <li key={c.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13.5px] font-medium text-zinc-800">{c.name}</span>
                    <span className="text-[11px] text-zinc-400">{c.lang}{c.focus ? ` · ${c.focus}` : ''}</span>
                    <span className="ml-auto font-mono text-[11px] text-zinc-400">
                      {contents.filter((x) => x.creator_id === c.id).length} 条
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1.5">
                    {(c.handles ?? []).map((h: any, i: number) => (
                      <span key={i} className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-500">
                        {h.platform}:{h.handle}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="lg:col-span-3"
          title={<span className="flex items-center gap-1.5"><Books size={15} weight="bold" className="text-zinc-600" />L0 内容库 · {contents.length}</span>}>
          {contents.length === 0 ? (
            <EmptyState icon={<VideoCamera size={26} weight="thin" />} title="还没有入库内容"
              hint="python -m analyzer.knowledge.transcribe_video <handle> <video_id>" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
                    <th className="py-1.5 pr-3 font-medium">标题</th>
                    <th className="py-1.5 pr-3 font-medium">信源</th>
                    <th className="py-1.5 pr-3 font-medium">发布</th>
                    <th className="py-1.5 pr-3 text-right font-medium">字数</th>
                    <th className="py-1.5 pr-3 text-right font-medium">单元</th>
                    <th className="py-1.5 pr-3 font-medium">状态</th>
                    <th className="py-1.5 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {contents.map((c) => {
                    const st = STATUS[c.status] ?? { label: c.status, tone: 'neutral' as const }
                    return (
                      <tr key={c.id} onClick={() => fetchKnowledgeContent(c.id).then(setDetail).catch(() => {})}
                        className="group cursor-pointer text-zinc-700 transition-colors hover:bg-zinc-50/70">
                        <td className="max-w-[340px] truncate py-2 pr-3 font-medium text-zinc-800" title={c.title}>{c.title ?? '—'}</td>
                        <td className="py-2 pr-3 text-zinc-500">{c.creator}</td>
                        <td className="py-2 pr-3 font-mono text-xs text-zinc-500">{when(c.published_at)}</td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-500">{(c.raw_len ?? 0).toLocaleString()}</td>
                        <td className="py-2 pr-3 text-right font-mono tabular-nums text-zinc-500">{c.n_units ?? 0}</td>
                        <td className="py-2 pr-3"><Badge tone={st.tone}>{st.label}</Badge></td>
                        <td className="py-2 text-right">
                          <CaretRight size={13} className="inline text-zinc-300 transition-colors group-hover:text-zinc-500" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </PageShell>
  )
}
