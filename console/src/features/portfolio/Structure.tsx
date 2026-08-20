import { useMemo, useState } from 'react'
import { cn } from '../../lib/cn'
import { money, percent, WALLET_LABEL } from '../../lib/format'
import type { FuturesAccount, MarginAccount, WalletBucket } from '../../api/types'

const RAMP = ['var(--seg-1)', 'var(--seg-2)', 'var(--seg-3)', 'var(--seg-4)', 'var(--seg-5)', 'var(--seg-6)']

/**
 * 钱在哪儿：一根比例条 + 一行图例，替代原来六行的钱包列表。
 * 同样的信息，占六分之一的纵向空间，而且"谁大谁小"是一眼的事。
 */
function AllocationBar({ wallets }: { wallets: WalletBucket[] }) {
  const [active, setActive] = useState<string | null>(null)

  const { segments, total, missing } = useMemo(() => {
    const usable = wallets.filter((b) => b.activate)
    const priced = usable.filter((b) => b.value_usd !== null)
    const sum = priced.reduce((acc, b) => acc + (b.value_usd ?? 0), 0)
    const ranked = [...priced].sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0))
    return {
      segments: ranked.map((bucket, index) => ({
        kind: bucket.kind,
        value: bucket.value_usd ?? 0,
        share: sum > 0 ? (bucket.value_usd ?? 0) / sum : 0,
        color: RAMP[index] ?? 'var(--seg-rest)',
      })),
      total: sum,
      missing: usable.filter((b) => b.value_usd === null).map((b) => b.kind),
    }
  }, [wallets])

  if (segments.length === 0) return <p className="text-sm text-ink-3">没有可用的钱包数据。</p>
  const hovered = segments.find((s) => s.kind === active) ?? null

  return (
    <div onMouseLeave={() => setActive(null)}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="label">资产结构</span>
        <span className="tnum text-xs text-ink-3">
          {hovered
            ? `${WALLET_LABEL[hovered.kind] ?? hovered.kind} · ${money(hovered.value)}`
            : money(total)}
        </span>
      </div>

      <div
        aria-label={`资产结构：${segments.map((s) => `${WALLET_LABEL[s.kind] ?? s.kind} ${percent(s.share)}`).join('，')}`}
        className="mt-3 flex h-3 w-full gap-[3px]"
        role="img"
      >
        {segments.map((segment) => (
          <button
            aria-label={`${WALLET_LABEL[segment.kind] ?? segment.kind} ${percent(segment.share)}`}
            className={cn(
              'h-full min-w-[3px] rounded-[2px] transition-opacity duration-300',
              active && active !== segment.kind ? 'opacity-30' : 'opacity-100',
            )}
            key={segment.kind}
            onBlur={() => setActive(null)}
            onFocus={() => setActive(segment.kind)}
            onMouseEnter={() => setActive(segment.kind)}
            style={{ flexGrow: Math.max(segment.share, 0.012), background: segment.color }}
            type="button"
          />
        ))}
      </div>

      <ul className="mt-3.5 flex flex-wrap gap-x-6 gap-y-2">
        {segments.map((segment) => (
          <li
            className={cn('flex items-baseline gap-2 transition-opacity duration-200',
              active && active !== segment.kind ? 'opacity-40' : 'opacity-100')}
            key={segment.kind}
            onMouseEnter={() => setActive(segment.kind)}
          >
            <span className="size-2 translate-y-px rounded-[2px]" style={{ background: segment.color }} />
            <span className="text-sm text-ink-2">{WALLET_LABEL[segment.kind] ?? segment.kind}</span>
            <span className="tnum text-sm text-ink-3">{percent(segment.share, 0)}</span>
          </li>
        ))}
        {missing.map((kind) => (
          <li className="flex items-baseline gap-2" key={kind}>
            <span className="size-2 translate-y-px rounded-[2px] border border-loss" />
            <span className="text-sm text-ink-2">{WALLET_LABEL[kind] ?? kind}</span>
            <span className="text-sm text-loss">取不到</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Reading({ label, value, note, tone }: {
  label: string
  value: string
  note?: string
  tone?: 'gain' | 'loss' | 'accent'
}) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-1.5 flex items-baseline gap-2">
        <span className={cn('tnum text-lg',
          tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : tone === 'accent' ? 'text-accent' : 'text-ink')}>
          {value}
        </span>
        {note && <span className="text-xs text-ink-3">{note}</span>}
      </dd>
    </div>
  )
}

/** 风险只留最能决定"要不要现在处理"的两三个读数，其余进明细 */
export function Structure({ wallets, futures, margin, exposureRatio, concentration, futuresMissing, veiled }: {
  wallets: WalletBucket[]
  futures: FuturesAccount | null
  margin: MarginAccount | null
  exposureRatio: number | null
  concentration: { asset: string; share: number } | null
  futuresMissing: boolean
  veiled: boolean
}) {
  const ratio = futures?.margin_ratio ?? null
  const marginTone = ratio === null ? undefined : ratio < 0.5 ? 'gain' : ratio < 0.8 ? 'accent' : 'loss'
  const marginNote = ratio === null ? undefined : ratio < 0.5 ? '安全' : ratio < 0.8 ? '偏紧' : '危险'
  const level = margin?.margin_level ?? null

  return (
    <section className={cn('grid gap-9 border-t border-rule px-6 py-7 sm:px-12 sm:py-9 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-14', veiled && 'veiled')}>
      <AllocationBar wallets={wallets} />

      <div className="lg:border-l lg:border-rule lg:pl-14">
        <span className="label">风险</span>
        {futuresMissing && ratio === null ? (
          <p className="mt-3 text-sm leading-relaxed text-ink-3">
            合约数据本次没有取到，保证金率与强平距离算不出来，这一节不猜。
          </p>
        ) : (
          <dl className="mt-3.5 grid grid-cols-2 gap-x-8 gap-y-5">
            {ratio !== null && (
              <Reading label="合约保证金率" note={marginNote} tone={marginTone} value={percent(ratio, 1)} />
            )}
            {level !== null && (
              <Reading
                label="杠杆账户风险率"
                note={level < 1.5 ? '偏紧' : '安全'}
                tone={level < 1.5 ? 'accent' : undefined}
                value={level.toFixed(2)}
              />
            )}
            {exposureRatio !== null && (
              <Reading label="真实杠杆" note="名义敞口 / 净值" value={`${exposureRatio.toFixed(2)}×`} />
            )}
            {concentration && (
              <Reading label="最大单一持仓" note={concentration.asset} value={percent(concentration.share, 1)} />
            )}
          </dl>
        )}
      </div>
    </section>
  )
}
