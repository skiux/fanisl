import { Flask } from '@phosphor-icons/react'
import { SCENARIOS, type Scenario } from '../api/client'

/**
 * 后端还没写，界面靠这个切各种状态。失败态和成功态要能被同等地看见、
 * 同等地评审——否则失败态一定是最后才补、补得最潦草的那部分。
 */
export function ScenarioSwitcher({
  value, onChange,
}: { value: Scenario; onChange: (next: Scenario) => void }) {
  return (
    <label className="flex items-center gap-1.5 rounded-[var(--radius-control)] border border-dashed border-rule px-2 py-1 text-ink-3 transition-colors hover:border-rule-strong">
      <Flask size={13} />
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
