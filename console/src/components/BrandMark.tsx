/**
 * Console 的标志。
 *
 * 从 FANISL 家族标志来（知识库与登录页那个：左上角框 + 一条线 + 一个点），保留角框与
 * 点，把那条斜线换成一段先抑后扬的价格线，点用金色实心——Console 看的是行情与资产，
 * 金色是这套界面里唯一的品牌色（`--accent`）。线条跟着 `currentColor` 走，深浅主题
 * 自己换色；点跟着 `--accent`，浅色主题是深金、深色主题是亮金。
 *
 * 同一套几何还画在 `public/favicon.svg`（深色图块上的浅色线，标签页里用）与
 * `public/apple-touch-icon.png` 里；改这里的话那两份要一起改。
 */
export function BrandMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg aria-hidden="true" className={className} height={size} viewBox="0 0 28 28" width={size}>
      <path d="M2 26V2h24" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path
        d="M6.5 21.5l6-7.5 3.5 3 5.5-7.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="square"
        strokeWidth="2.4"
      />
      <circle cx="21.5" cy="9.5" fill="var(--accent)" r="3.4" />
    </svg>
  )
}
