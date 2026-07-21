import { ArrowRight, Warning, XCircle } from '@phosphor-icons/react'
import { api, type VerificationItem } from '../api'
import { navigate } from '../router'
import { useResource, type Resource } from '../useResource'

const OUTCOME: Record<string, { label: string; cls: string }> = {
  hit: { label: 'HIT', cls: 'is-hit' },
  partial: { label: 'PARTIAL', cls: 'is-partial' },
  miss: { label: 'MISS', cls: 'is-miss' },
  condition_not_met: { label: 'NOT TRIGGERED', cls: 'is-muted' },
  condition_unverifiable: { label: 'UNVERIFIABLE', cls: 'is-issue' },
  unpriceable: { label: 'NO PRICE', cls: 'is-issue' },
}

function shortDate(value?: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: '2-digit' }).format(new Date(value)).toUpperCase()
}

function ResourceState({ resource, label }: { resource: Resource<any>; label: string }) {
  if (resource.loading && resource.data == null) return <div className="fn-state"><span className="fn-state__pulse" />LOADING {label.toUpperCase()}</div>
  if (resource.error && resource.data == null) return <div className="fn-state fn-state--error"><XCircle size={16} /><span>{label} unavailable · {resource.error.message}</span><button onClick={resource.reload}>RETRY</button></div>
  return null
}

function Stat({ label, value, note, tone = 'base', onClick }: { label: string; value: number | string; note: string; tone?: string; onClick?: () => void }) {
  const body = <><span className="fn-stat__label">{label}</span><strong className={`fn-stat__value is-${tone}`}>{value}</strong><small>{note}</small></>
  return onClick ? <button className="fn-stat" onClick={onClick}>{body}<ArrowRight size={14} /></button> : <div className="fn-stat">{body}</div>
}

function QueueItem({ item, kind }: { item: VerificationItem; kind: 'issue' | 'due' | 'review' }) {
  const meta = item.payload ?? {}
  const asset = meta.asset_symbol ?? meta.asset_text ?? 'NON-PRICE'
  const route = item.score_id ? `/verify?score=${item.score_id}` : `/investigate?unit=${item.unit_id}`
  const reason = kind === 'issue'
    ? item.outcome === 'unpriceable' ? 'Market data unavailable' : 'Condition cannot be observed mechanically'
    : kind === 'review' ? 'Condition not triggered — context review required' : `Frozen evaluation due ${item.horizon_label}`
  return <button className={`fn-queue-row is-${kind}`} onClick={() => navigate(route)}>
    <span className="fn-queue-row__flag">{kind === 'issue' ? 'DATA' : kind === 'review' ? 'REVIEW' : item.horizon_label.slice(5)}</span>
    <span className="fn-queue-row__body"><span className="fn-queue-row__top"><b>{asset}</b><small>{item.creator} · {shortDate(item.published_at)}</small></span><span className="fn-queue-row__quote">{item.quote}</span><span className="fn-queue-row__reason">{reason}</span></span>
    <ArrowRight size={16} />
  </button>
}

function VerdictRow({ item }: { item: VerificationItem }) {
  const verdict = OUTCOME[item.outcome ?? ''] ?? { label: item.outcome ?? 'UNKNOWN', cls: 'is-muted' }
  const spec = item.payload?.scoring_spec
  return <button className="fn-verdict" onClick={() => navigate(`/verify?score=${item.score_id}`)}>
    <span className={`fn-verdict__outcome ${verdict.cls}`}>{verdict.label}</span>
    <span className="fn-verdict__main"><b>{item.payload?.asset_symbol ?? item.payload?.asset_text ?? 'CLAIM'}</b><span>{item.quote}</span></span>
    <span className="fn-verdict__rule"><small>RULE</small>{spec?.method ?? '—'}</span>
    <span className="fn-verdict__result"><small>FINAL</small>{item.realized?.eval_close ?? '—'}</span>
    <span className="fn-verdict__date">{shortDate(item.eval_ts)}</span>
  </button>
}

export default function Desk() {
  const queue = useResource(api.verificationQueue, [], 60000)
  const weekly = useResource(api.weekly, [], 60000)
  const conflicts = useResource(api.conflicts, [], 60000)
  const collection = useResource(api.collectionStatus, [], 60000)
  const spot = useResource(api.spotChecks, [], 60000)
  const summary = weekly.data?.summary
  const contentCount = summary?.new_contents.reduce((total, row) => total + row.n, 0) ?? '—'
  const unitCount = summary?.new_units.reduce((total, row) => total + row.n, 0) ?? '—'
  const failedJobs = collection.data?.runs.filter((run) => !run.ok) ?? []
  const staleJobs = collection.data?.runs.filter((run) => Date.now() - new Date(run.started_at).getTime() > 36 * 60 * 60 * 1000) ?? []
  const focus = queue.data ? [
    ...queue.data.unavailable.slice(0, 2).map((item) => ({ item, kind: 'issue' as const })),
    ...queue.data.due.slice(0, 4).map((item) => ({ item, kind: 'due' as const })),
    ...queue.data.review.slice(0, 2).map((item) => ({ item, kind: 'review' as const })),
  ] : []

  return <main className="fn-desk">
    <header className="fn-pagehead">
      <div><p className="fn-kicker">Research command desk · 14 day horizon</p><h1>WHAT REQUIRES ATTENTION NOW?</h1></div>
      <div className="fn-pagehead__meta"><span>KNOWLEDGE DAILY</span><b>{new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', weekday: 'short' }).format(new Date())}</b></div>
    </header>

    <section className="fn-stats" aria-label="工作概览">
      <ResourceState resource={queue} label="verification queue" />
      {queue.data && <>
        <Stat label="DUE" value={queue.data.overview.due} note="frozen claims approaching evaluation" tone="warn" onClick={() => navigate('/verify?queue=due')} />
        <Stat label="DATA ISSUES" value={queue.data.overview.unavailable} note="cannot produce a valid verdict" tone="danger" onClick={() => navigate('/verify?queue=unavailable')} />
        <Stat label="REVIEW" value={queue.data.overview.review} note="conditions require interpretation" tone="accent" onClick={() => navigate('/verify?queue=review')} />
        <Stat label="VERDICTS" value={queue.data.overview.completed} note="auditable market evaluations" onClick={() => navigate('/verify?queue=recent')} />
      </>}
      <Stat label="NEW L0" value={contentCount} note="immutable source content this week" />
      <Stat label="NEW L1" value={unitCount} note="claims, methods and concepts" />
    </section>

    <div className="fn-desk-grid">
      <section className="fn-panel fn-panel--focus">
        <header className="fn-panel__head"><div><span className="fn-panel__number">01</span><div><p>PRIMARY QUEUE</p><h2>Focus before reading the feed</h2></div></div><button onClick={() => navigate('/verify')}>OPEN VERIFY <ArrowRight size={13} /></button></header>
        <ResourceState resource={queue} label="focus queue" />
        {queue.data && <div className="fn-queue">{focus.length ? focus.map(({ item, kind }) => <QueueItem key={`${kind}-${item.score_id ?? item.unit_id}-${item.horizon_label}`} item={item} kind={kind} />) : <div className="fn-empty">No due, blocked or review items. The queue is genuinely clear.</div>}</div>}
      </section>

      <aside className="fn-panel fn-panel--signal">
        <header className="fn-panel__head"><div><span className="fn-panel__number">02</span><div><p>PIPELINE SIGNAL</p><h2>Coverage & health</h2></div></div></header>
        <ResourceState resource={collection} label="collection status" />
        {collection.data && <div className="fn-health">
          <div className={`fn-health__banner ${failedJobs.length ? 'is-error' : staleJobs.length ? 'is-warning' : collection.data.enabled ? 'is-ok' : 'is-warning'}`}><span>{failedJobs.length ? 'DEGRADED' : staleJobs.length ? 'STALE' : collection.data.enabled ? 'OPERATIONAL' : 'COLLECTOR OFF'}</span><b>{failedJobs.length ? `${failedJobs.length} JOB FAILURE${failedJobs.length > 1 ? 'S' : ''}` : staleJobs.length ? `${staleJobs.length} JOBS OUT OF DATE` : 'NO REPORTED FAILURES'}</b></div>
          <div className="fn-health__runs">{collection.data.runs.slice(0, 6).map((run) => <div key={run.job}><span className={`fn-led ${run.ok ? 'is-ok' : 'is-error'}`} /><b>{run.job}</b><time>{shortDate(run.started_at)}</time></div>)}{collection.data.runs.length === 0 && <p>No collector runs recorded.</p>}</div>
        </div>}
        <ResourceState resource={spot} label="spot-check coverage" />
        {spot.data && <div className="fn-coverage"><div className="fn-coverage__top"><span><small>HUMAN AUDIT</small><b>{spot.data.checked}/{spot.data.total}</b></span><strong>{spot.data.total ? ((spot.data.checked / spot.data.total) * 100).toFixed(1) : '0.0'}%</strong></div><div className="fn-coverage__bar"><i style={{ width: `${spot.data.total ? (spot.data.checked / spot.data.total) * 100 : 0}%` }} /></div><p>{spot.data.faithful} faithful · {spot.data.unfaithful} unfaithful · {spot.data.unclear} unclear</p></div>}
      </aside>

      <section className="fn-panel fn-panel--verdicts">
        <header className="fn-panel__head"><div><span className="fn-panel__number">03</span><div><p>MARKET VERDICTS</p><h2>What the market just resolved</h2></div></div><span className="fn-panel__legend"><i className="is-hit" /> HIT <i className="is-partial" /> PARTIAL <i className="is-miss" /> MISS</span></header>
        <ResourceState resource={queue} label="recent verdicts" />
        {queue.data && <div className="fn-verdicts">{queue.data.recent.slice(0, 7).map((item) => <VerdictRow key={item.score_id} item={item} />)}{queue.data.recent.length === 0 && <div className="fn-empty">No recent verdicts. Due claims remain visible in the primary queue.</div>}</div>}
      </section>

      <section className="fn-panel fn-panel--conflicts">
        <header className="fn-panel__head"><div><span className="fn-panel__number">04</span><div><p>KNOWLEDGE TENSIONS</p><h2>Contradictions worth investigating</h2></div></div><button onClick={() => navigate('/investigate?view=conflicts')}>INVESTIGATE <ArrowRight size={13} /></button></header>
        <ResourceState resource={conflicts} label="knowledge conflicts" />
        {conflicts.data && <div className="fn-conflicts">{conflicts.data.slice(0, 4).map((relation) => <button key={relation.id} onClick={() => navigate(`/investigate?node=${relation.a_id}&compare=${relation.b_id}`)}><span className="fn-conflicts__symbol"><Warning size={15} weight="fill" />CONFLICT</span><span className="fn-conflicts__pair"><b>{relation.a_title}</b><i>VERSUS</i><b>{relation.b_title}</b></span><span className="fn-conflicts__note">{relation.note}</span><ArrowRight size={15} /></button>)}{conflicts.data.length === 0 && <div className="fn-empty">No registered cross-source conflicts. This does not prove counter-evidence is absent.</div>}</div>}
      </section>
    </div>
  </main>
}
