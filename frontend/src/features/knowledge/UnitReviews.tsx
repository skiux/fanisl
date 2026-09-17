import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react'
import { getSession, subscribe } from '../../shared/auth/session'
import { resolutionOutcomeLabels, reviewCategoryLabels, reviewStatusLabels } from '../../shared/domain/labels'
import {
  REVIEW_BODY_MAX, REVIEW_CATEGORIES, closeReview, fieldLabel, replyToReview, reviewErrorMessage,
  snapshotValue, submitReview, unclosedCount,
  type ReviewCategory, type ReviewMessage, type ReviewResolution, type UnitAmendment, type UnitReview,
} from './reviews'
import './unit-reviews.css'

type LoadState = 'loading' | 'loaded' | 'error'

function formatTime(value: string | null | undefined) {
  if (!value) return '时间未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: 'Asia/Shanghai',
  }).format(date)
}

function ReviewTextarea({ autoFocus = false, label, onChange, placeholder, value }: {
  autoFocus?: boolean
  label: string
  onChange: (value: string) => void
  placeholder: string
  value: string
}) {
  // 计数器放在 label 外面：放在里面会被读进输入框的可访问名称（"具体说明 0 / 4000"）
  return (
    <div className="review-textarea">
      <label>
        <span>{label}</span>
        <textarea
          autoFocus={autoFocus}
          maxLength={REVIEW_BODY_MAX}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={5}
          value={value}
        />
      </label>
      <small data-near-limit={value.length > REVIEW_BODY_MAX * .9 ? 'true' : undefined}>
        {value.length} / {REVIEW_BODY_MAX}
      </small>
    </div>
  )
}

function ReviewComposer({ onSubmitted, startOpen, unitId }: {
  onSubmitted: (review: UnitReview) => void
  startOpen: boolean
  unitId: number
}) {
  const [open, setOpen] = useState(startOpen)
  const [category, setCategory] = useState<ReviewCategory | null>(null)
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button className="review-compose-open" onClick={() => setOpen(true)} type="button">
        ＋ 对这条提取提出核查
      </button>
    )
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!category || !body.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    submitReview(unitId, category, body.trim())
      .then((review) => {
        setCategory(null)
        setBody('')
        setOpen(false)
        onSubmitted(review)
      })
      .catch((reason) => setError(reviewErrorMessage(reason)))
      .finally(() => setSubmitting(false))
  }

  return (
    <form aria-label="提出核查" className="review-composer" onSubmit={submit}>
      <header>
        <p>提出核查</p>
        <button onClick={() => { setOpen(false); setError(null) }} type="button">收起</button>
      </header>
      <fieldset>
        <legend>问题出在哪一类</legend>
        <div className="review-category-options">
          {REVIEW_CATEGORIES.map((value) => (
            <label data-checked={category === value ? 'true' : undefined} key={value}>
              <input
                checked={category === value}
                name={`review-category-${unitId}`}
                onChange={() => setCategory(value)}
                type="radio"
                value={value}
              />
              <span>{reviewCategoryLabels[value]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <ReviewTextarea
        label="具体说明"
        onChange={setBody}
        placeholder="写清哪里不对、依据是什么。例如：quote 截掉了后半句的条件，原意是「跌破 4288 才看空」，不是无条件看空。"
        value={body}
      />
      {error && <p className="review-error" role="alert">{error}</p>}
      <footer>
        <span>{category ? '提交后进入知识席位的待办，答复会出现在这里。' : '先选一个类别。'}</span>
        <button disabled={!category || !body.trim() || submitting} type="submit">
          {submitting ? '正在提交…' : '提交核查'}
        </button>
      </footer>
    </form>
  )
}

/** 知识席位的复盘原样展示：结论、为什么会错、同类排查、后续，一项都不折叠。 */
function Resolution({ resolution }: { resolution: ReviewResolution }) {
  const rows: Array<[string, string | null]> = [
    ['为什么会错', resolution.root_cause],
    ['同类排查', resolution.sweep],
    ['后续', resolution.followup],
  ]
  return (
    <dl className="review-resolution" data-outcome={resolution.outcome}>
      <div>
        <dt>结论</dt>
        <dd><b>{resolutionOutcomeLabels[resolution.outcome] ?? resolution.outcome}</b></dd>
      </div>
      {rows.filter(([, text]) => text).map(([label, text]) => (
        <div key={label}><dt>{label}</dt><dd>{text}</dd></div>
      ))}
    </dl>
  )
}

function SnapshotValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') return <em className="review-diff-empty">（无）</em>
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <p>{String(value)}</p>
  }
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value.length ? <p>{value.join(' · ')}</p> : <em className="review-diff-empty">（空）</em>
  }
  return <pre>{JSON.stringify(value, null, 2)}</pre>
}

function Amendment({ amendment }: { amendment: UnitAmendment }) {
  return (
    <article className="review-amendment">
      <header>
        <span>修改 #{amendment.id}</span>
        <time>{formatTime(amendment.created_at)} · {amendment.author}</time>
      </header>
      <p className="review-amendment-reason"><b>原因</b>{amendment.reason}</p>
      <ul aria-label="改动字段" className="review-changed">
        {amendment.changed.map((path) => <li key={path}>{fieldLabel(path)}<code>{path}</code></li>)}
      </ul>
      {amendment.changed.map((path) => (
        <div className="review-diff" key={path}>
          <div className="review-diff-side is-before">
            <span>改前 · {fieldLabel(path)}</span>
            <SnapshotValue value={snapshotValue(amendment.before, path)} />
          </div>
          <div className="review-diff-side is-after">
            <span>改后 · {fieldLabel(path)}</span>
            <SnapshotValue value={snapshotValue(amendment.after, path)} />
          </div>
        </div>
      ))}
    </article>
  )
}

const actionCopy = {
  open: {
    hint: '知识席位还没有答复。可以补充说明，或撤回这条意见。',
    reply: '补充说明',
    close: '撤回核查',
  },
  answered: {
    hint: '认可答复就关闭；不认可就回复，核查会回到知识席位的待办。',
    reply: '不认可，回复',
    close: '认可并关闭',
  },
  closed: {
    hint: '这条核查已经关闭。仍有异议可以回复，它会重新打开。',
    reply: '回复并重新打开',
    close: null,
  },
} as const

function ReviewActions({ onChanged, review }: { onChanged: (review: UnitReview) => void; review: UnitReview }) {
  const [replying, setReplying] = useState(false)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState<'reply' | 'close' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const copy = actionCopy[review.status] ?? actionCopy.open

  const run = (kind: 'reply' | 'close') => {
    if (busy || (kind === 'reply' && !body.trim())) return
    setBusy(kind)
    setError(null)
    const request = kind === 'reply' ? replyToReview(review.id, body.trim()) : closeReview(review.id)
    request
      .then((next) => {
        setBody('')
        setReplying(false)
        onChanged(next)
      })
      .catch((reason) => setError(reviewErrorMessage(reason)))
      .finally(() => setBusy(null))
  }

  return (
    <footer className="review-actions">
      {replying ? (
        <form className="review-reply" onSubmit={(event) => { event.preventDefault(); run('reply') }}>
          <ReviewTextarea
            autoFocus
            label={review.status === 'open' ? '补充说明' : '回复知识席位'}
            onChange={setBody}
            placeholder={review.status === 'answered'
              ? '说明哪里不认可，最好指到原文的具体句子。'
              : '补充依据或更正之前的描述。'}
            value={body}
          />
          {review.status !== 'open' && <p className="review-reply-note">发送后这条核查会回到「待知识席位答复」。</p>}
          <div className="review-reply-buttons">
            <button onClick={() => { setReplying(false); setBody(''); setError(null) }} type="button">取消</button>
            <button disabled={!body.trim() || busy !== null} type="submit">{busy === 'reply' ? '正在发送…' : '发送'}</button>
          </div>
        </form>
      ) : (
        <div className="review-action-row">
          <p>{copy.hint}</p>
          <div>
            <button disabled={busy !== null} onClick={() => setReplying(true)} type="button">{copy.reply}</button>
            {copy.close && (
              <button
                data-primary={review.status === 'answered' ? 'true' : undefined}
                disabled={busy !== null}
                onClick={() => run('close')}
                type="button"
              >
                {busy === 'close' ? '正在关闭…' : copy.close}
              </button>
            )}
          </div>
        </div>
      )}
      {error && <p className="review-error" role="alert">{error}</p>}
    </footer>
  )
}

function roleLabel(message: ReviewMessage, me: string | null) {
  if (message.role === 'extractor') return '知识席位'
  return message.author === me ? '你' : '站上用户'
}

function ReviewCard({ focused, me, onChanged, review }: {
  focused: boolean
  me: string | null
  onChanged: (review: UnitReview) => void
  review: UnitReview
}) {
  return (
    <article
      aria-label={`核查 #${review.id}`}
      className="review-card"
      data-focused={focused ? 'true' : undefined}
      data-status={review.status}
      id={`unit-review-${review.id}`}
    >
      <header>
        <span className="review-status">{reviewStatusLabels[review.status] ?? review.status}</span>
        <b>{reviewCategoryLabels[review.category] ?? review.category}</b>
        <time>
          #{review.id} · {formatTime(review.created_at)} 提交
          {review.status === 'closed' && review.closed_at ? ` · ${formatTime(review.closed_at)} 关闭` : ''}
        </time>
      </header>
      <ol className="review-thread">
        {review.messages.map((message) => (
          <li data-role={message.role} key={message.id}>
            <div className="review-message-meta">
              <b>{roleLabel(message, me)}</b>
              <span>{message.author}</span>
              <time>{formatTime(message.created_at)}</time>
            </div>
            <p className="review-message-body">{message.body}</p>
            {message.resolution && <Resolution resolution={message.resolution} />}
          </li>
        ))}
      </ol>
      {review.amendments.length > 0 && (
        <section aria-label="修改记录" className="review-amendments">
          <header>
            <p>修改记录</p>
            <span>{review.amendments.length} 次 · 改前改后全量留痕，改动已写回单元</span>
          </header>
          {review.amendments.map((amendment) => <Amendment amendment={amendment} key={amendment.id} />)}
        </section>
      )}
      <ReviewActions onChanged={onChanged} review={review} />
    </article>
  )
}

/**
 * 单元核查：用户对一条提取提出异议，知识席位用 CLI 审查后答复，改了单元就留下改前改后。
 *
 * 列表与计数由上层（EvidenceDossier）持有，因为 tab 上要显示未关闭的条数，而 tab 在面板之外。
 *
 * 不分角色：能进站的都已登录，提交、回复、关闭对谁都开放。角色只属于资产台（根 AGENTS.md §1）。
 */
function UnitReviews({ focusReviewId = null, onChanged, onRetry, reviews, state, unitId }: {
  focusReviewId?: number | null
  onChanged: (review: UnitReview) => void
  onRetry: () => void
  reviews: UnitReview[] | null
  state: LoadState
  unitId: number
}) {
  const session = useSyncExternalStore(subscribe, getSession)
  const user = session.status === 'authenticated' ? session.user : null
  const list = reviews ?? []
  const unclosed = unclosedCount(list)

  useEffect(() => {
    if (state !== 'loaded' || !focusReviewId) return
    document.getElementById(`unit-review-${focusReviewId}`)?.scrollIntoView({ block: 'start' })
  }, [focusReviewId, state])

  return (
    <section aria-label="单元核查" className="unit-review-section">
      <header>
        <div>
          <p>核查</p>
          <span>觉得这条提取有问题——引文断章取义、分级判错、判据不对——就在这里提。知识席位逐条审查后在此答复；改了单元，改前改后一并留下。</span>
        </div>
        <b>{state === 'loaded' ? (unclosed ? `${unclosed} 条未关闭` : `${list.length} 条`) : '—'}</b>
      </header>

      {state === 'loading' && <div aria-label="正在读取核查记录" className="review-loading"><i /><i /></div>}
      {state === 'error' && (
        <div className="review-load-error">
          <p>核查记录暂时没有载入。单元本身不受影响。</p>
          <button onClick={onRetry} type="button">重新读取</button>
        </div>
      )}

      {state !== 'loading' && (
        <ReviewComposer onSubmitted={onChanged} startOpen={state === 'loaded' && list.length === 0} unitId={unitId} />
      )}

      {state === 'loaded' && list.length === 0 && <p className="review-empty">这条单元还没有核查。</p>}

      {list.map((review) => (
        <ReviewCard
          focused={review.id === focusReviewId}
          key={review.id}
          me={user?.username ?? null}
          onChanged={onChanged}
          review={review}
        />
      ))}
    </section>
  )
}

export default UnitReviews
