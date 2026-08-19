import { Eyebrow } from '../../components/Primitives'
import { cn } from '../../lib/cn'
import { money, percent, WALLET_LABEL } from '../../lib/format'
import type { WalletBucket } from '../../api/types'

/**
 * 钱在哪儿。Binance 的钱分散在六个钱包里（/sapi/v1/asset/wallet/balance），
 * 只画"现货 + 合约"会漏掉理财、资金账户和杠杆里的钱。
 */
export function WalletSpread({ wallets, veiled }: { wallets: WalletBucket[]; veiled: boolean }) {
  const usable = wallets.filter((bucket) => bucket.activate)
  const total = usable.reduce((sum, bucket) => sum + (bucket.value_usd ?? 0), 0)
  const ranked = [...usable].sort((a, b) => (b.value_usd ?? -1) - (a.value_usd ?? -1))
  if (ranked.length === 0) return null

  return (
    <section className={cn(veiled && 'veiled')}>
      <div className="flex items-baseline justify-between">
        <Eyebrow>钱包分布</Eyebrow>
        <span className="text-xs text-fg-3">{ranked.length} 个已启用</span>
      </div>

      <ul className="mt-2.5 grid gap-x-8 gap-y-px sm:grid-cols-2 xl:grid-cols-1">
        {ranked.map((bucket) => {
          const missing = bucket.value_usd === null
          const share = missing || total <= 0 ? 0 : bucket.value_usd! / total
          return (
            <li className="flex items-center gap-3 border-b border-line py-2 last:border-b-0" key={bucket.kind}>
              <span className="w-[72px] shrink-0 text-xs text-fg-2">
                {WALLET_LABEL[bucket.kind] ?? bucket.kind}
              </span>
              <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-line">
                <span
                  className="block h-full rounded-full bg-fg-3 transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                  style={{ width: `${(share * 100).toFixed(2)}%` }}
                />
              </span>
              {missing ? (
                <span className="w-[92px] shrink-0 text-right text-xs text-loss">取不到</span>
              ) : (
                <>
                  <span className="tnum w-[86px] shrink-0 text-right text-xs text-fg">
                    {money(bucket.value_usd)}
                  </span>
                  <span className="tnum w-[38px] shrink-0 text-right text-xs text-fg-3">
                    {percent(share, 0)}
                  </span>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
