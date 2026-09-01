import { Flask } from '@phosphor-icons/react'
import { MOCKS_AVAILABLE, SCENARIOS, type Scenario } from '../api/client'

/**
 * 数据来源切换器：`实时` 走真后端，其余是 mock 场景。
 *
 * 后端上线后没有删掉 mock 层，是因为它是**评审降级态的唯一实用手段**：
 * 451、限流、Key 失效这些状态没法靠等来复现，而它们恰恰是这三页设计上最花心思的部分。
 * 只在开发构建里可见。
 */
export function ScenarioSwitcher({
  value, onChange,
}: { value: Scenario; onChange: (next: Scenario) => void }) {
  // 生产构建里不出现。留着这个开关，迟早有人把它停在"数据陈旧"上，
  // 然后以为自己的账户真的陈旧了。
  if (!MOCKS_AVAILABLE) return null
  return (
    <label className="flex items-center gap-1.5 rounded-[var(--radius-control)] border border-dashed border-rule px-2 py-1 text-ink-3 transition-colors hover:border-rule-strong">
      <Flask aria-hidden="true" size={13} />
      <span className="sr-only">示例数据场景</span>
      <select
        className="cursor-pointer appearance-none bg-transparent pr-1 text-[12px] text-ink-2 outline-none"
        onChange={(event) => onChange(event.target.value as Scenario)}
        value={value}
      >
        {Object.entries(SCENARIOS).map(([key, label]) => (
          <option className="bg-sheet text-ink" key={key} value={key}>{label}</option>
        ))}
      </select>
    </label>
  )
}
