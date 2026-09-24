import { useEffect, useRef } from 'react'
import { useModalFocus } from '../../shared/interaction/useModalFocus'
import { asText, claimHeadline } from '../asset/format'
import RecordBody from './RecordBody'
import { isScored, type QueueItem } from './records'

/**
 * 一条记录的浮层。列表不因为看一条记录而变长；← → 或右上角的箭头逐条看，列表在背后跟着翻页。
 * 内容按 1440×900 一屏放下设计，只有原话与判定标准都特别长时浮层自己才会滚。
 */
function RecordDialog({ item, onClose, onOpenUnit, onSelect, onStep, position, total, unitItems }: {
  item: QueueItem
  onClose: () => void
  onOpenUnit: (unitId: number) => void
  onSelect: (item: QueueItem) => void
  /** -1 上一条，1 下一条 */
  onStep: (delta: number) => void
  /** 在当前列表里的位置；记录被筛选条件排除时为 -1，不给逐条查看 */
  position: number
  total: number
  unitItems: QueueItem[]
}) {
  const dialogRef = useRef<HTMLElement>(null)
  useModalFocus(dialogRef, true, onClose)

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const dialog = dialogRef.current
      if (!dialog || dialog.inert || position < 0) return
      if (event.target instanceof HTMLElement && event.target.closest('input, select, textarea')) return
      if (event.key === 'ArrowLeft' && position > 0) onStep(-1)
      if (event.key === 'ArrowRight' && position < total - 1) onStep(1)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onStep, position, total])

  const symbol = asText(item.payload.asset_symbol)
  const headline = claimHeadline(item.payload, item.horizon_label)

  return (
    <div className="verify-dialog-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section
        aria-label={isScored(item) ? `判定记录 ${item.score_id}` : `到期记录 ${item.unit_id}`}
        aria-modal="true"
        className="verify-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <header>
          {/* 关闭按钮排在最前，打开时焦点先落在它上面；视觉上用 order 放到最右 */}
          <button aria-label="关闭" className="verify-dialog-close" onClick={onClose} type="button">×</button>
          <p>
            <b>{symbol ?? '未规范化标的'}</b>
            {headline && <span>{headline}</span>}
            <small>{item.creator}</small>
          </p>
          {position >= 0 && (
            <nav aria-label="逐条查看">
              <button aria-label="上一条" disabled={position === 0} onClick={() => onStep(-1)} type="button">‹</button>
              <span>{position + 1} / {total}</span>
              <button aria-label="下一条" disabled={position >= total - 1} onClick={() => onStep(1)} type="button">›</button>
            </nav>
          )}
        </header>
        <blockquote>{item.quote}</blockquote>
        <RecordBody item={item} onOpenUnit={onOpenUnit} onSelect={onSelect} unitItems={unitItems} />
      </section>
    </div>
  )
}

export default RecordDialog
