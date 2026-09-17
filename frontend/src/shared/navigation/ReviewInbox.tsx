import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  QUEUE_MESSAGE_MAX, QUEUE_QUOTE_MAX, REVIEWS_CHANGED, fetchAnsweredReviews, reviewHref,
  type ReviewQueueItem,
} from '../../features/knowledge/reviews'
import { getSession, subscribe } from '../auth/session'
import { kindLabels, reviewCategoryLabels } from '../domain/labels'
import './review-inbox.css'

/** 队列接口把 quote 截到 80 字、last_message 截到 120 字；到了上限就补个省略号，别让人以为话就这么长。 */
function clip(text: string, max: number) {
  return text.length >= max ? `${text}…` : text
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(date)
}

/**
 * 顶栏的「待确认」：知识席位答复了的核查（status=answered）在这里露头，点一条直达那个单元的核查 tab。
 *
 * 放在顶栏而不是知识库里，是因为日常入口是标的页——答复要在用户每天都会经过的地方被看见，
 * 否则只能逐个单元去翻，闭环就断了。
 *
 * 所有登录用户都有：核查不分角色。没有待确认时整个入口不渲染——
 * 顶栏在窄屏上本来就刚好排满（见 AccountMenu 的注释），不留一个常驻的空位。
 */
function ReviewInbox() {
  const session = useSyncExternalStore(subscribe, getSession)
  const signedIn = session.status === 'authenticated'
  const [items, setItems] = useState<ReviewQueueItem[]>([])
  const [open, setOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const refresh = () => setRefreshKey((value) => value + 1)
    window.addEventListener(REVIEWS_CHANGED, refresh)
    return () => window.removeEventListener(REVIEWS_CHANGED, refresh)
  }, [])

  useEffect(() => {
    if (!signedIn) return
    const controller = new AbortController()
    fetchAnsweredReviews(controller.signal)
      .then(setItems)
      // 入口只是提醒：取不到就当没有，不在顶栏上报错打断页面
      .catch(() => { if (!controller.signal.aborted) setItems([]) })
    return () => controller.abort()
  }, [signedIn, refreshKey])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  if (!signedIn || items.length === 0) return null

  return (
    <div className="review-inbox" ref={root}>
      <button
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`待确认的核查 ${items.length} 条`}
        className="review-inbox-trigger"
        onClick={() => setOpen((value) => !value)}
        ref={trigger}
        type="button"
      >
        <span>待确认</span>
        <b>{items.length}</b>
      </button>

      {open && (
        <div aria-label="待确认的核查" className="review-inbox-panel" role="region">
          <header>
            <b>知识席位已答复</b>
            <span>认可就关闭，不认可就回复。</span>
          </header>
          <ol>
            {items.map((item) => (
              <li key={item.id}>
                <a href={reviewHref(item.unit_id, item.id)} onClick={() => setOpen(false)}>
                  <span className="review-inbox-meta">
                    <b>{reviewCategoryLabels[item.category] ?? item.category}</b>
                    <i>{kindLabels[item.kind] ?? item.kind} #{item.unit_id} · {item.creator}</i>
                    <time>{formatTime(item.updated_at)}</time>
                  </span>
                  <strong>{clip(item.quote, QUEUE_QUOTE_MAX)}</strong>
                  {item.last_message && <p>{clip(item.last_message, QUEUE_MESSAGE_MAX)}</p>}
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

export default ReviewInbox
