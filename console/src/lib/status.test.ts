import { describe, expect, it } from 'vitest'
import type { SourceState } from '../api/types'
import { dataStatus } from './status'

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
const ok = (key: SourceState['key']): SourceState => ({ key, status: 'ok', as_of: ago(1), detail: null })

describe('报头的状态灯', () => {
  it('数据新、来源都取到：绿', () => {
    expect(dataStatus({ asOf: ago(2), sources: [ok('prices'), ok('wallets')] }).level).toBe('ok')
  })

  it('有来源没取到：黄，提示里点名；账户没开的功能不算', () => {
    const status = dataStatus({ asOf: ago(2), sources: [
      ok('prices'),
      { key: 'futures', status: 'unreachable', as_of: null, detail: '451' },
      { key: 'portfolio_margin', status: 'unsupported', as_of: null, detail: null },
    ] })
    expect(status.level).toBe('warn')
    expect(status.text).toContain('1 个来源未取到')
    expect(status.text).toContain('合约账户')
    expect(status.text).not.toContain('统一账户')
  })

  it('自动刷新失败但手上的数据还不旧：黄，提示里写原因', () => {
    const status = dataStatus({ asOf: ago(5), sources: [ok('prices')], refreshError: '上游 503' })
    expect(status).toEqual({ level: 'warn', text: '自动刷新失败：上游 503' })
  })

  it('超过 20 分钟：正在更新时是黄，没有在更新是红', () => {
    expect(dataStatus({ asOf: ago(45), sources: [], syncing: true }).level).toBe('warn')
    const stuck = dataStatus({ asOf: ago(45), sources: [], refreshError: '上游 503' })
    expect(stuck.level).toBe('error')
    expect(stuck.text).toContain('45 分钟前')
    expect(stuck.text).toContain('上游 503')
    expect(dataStatus({ asOf: null, sources: [] })).toEqual({ level: 'error', text: '还没有取到数据' })
  })
})
