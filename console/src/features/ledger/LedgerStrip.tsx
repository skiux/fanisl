import { Strip, type StripCell } from '../../components/Strip'
import { signedMoney } from '../../lib/format'
import type { LedgerSnapshot } from '../../api/types'
import { countsToNet } from './Timeline'

/**
 * 常驻摘要条。版式见 `components/Strip.tsx`。
 *
 * 原先这里有一格"取数成本"（权重 21,373 · 48 次调用），还有每格底下一行口径说明
 * （"没有统一接口，合并而来""进出与收支合计·不含内部搬运"）。都删了：那是接口
 * 的构造，属于 `binance/README.md`，不属于看钱的页面。
 *
 * "不完整 · N 个来源取不到"也删了，但理由不同——它不是解释而是警告，只是
 * **报头那一行已经在说同一句话**（同一个 `sources`，同样数出取不到的个数）。
 * 一句警告说两遍不会更醒目，只会让人以为是两回事。
 */
export function LedgerStrip({ snapshot, veiled }: { snapshot: LedgerSnapshot; veiled: boolean }) {
  const blind = snapshot.sources.every((source) => source.status !== 'ok')
  const net = snapshot.entries.filter(countsToNet)
    .reduce((sum, entry) => sum + (entry.value_usd ?? 0), 0)

  const cells: StripCell[] = [
    {
      label: '区间',
      // 天数不再另起一行：它就在上面的区间选择器里选中着
      value: `${snapshot.window.from.slice(5, 10)} → ${snapshot.window.to.slice(5, 10)}`,
    },
    {
      label: '记录数',
      value: blind ? '—' : String(snapshot.entries.length),
      tone: blind ? 'muted' : undefined,
    },
  ]

  return (
    <Strip
      cells={cells}
      hero={{
        label: '本期净额',
        value: blind ? '—' : signedMoney(net),
        tone: blind ? 'muted' : net >= 0 ? 'gain' : 'loss',
      }}
      veiled={veiled}
    />
  )
}
