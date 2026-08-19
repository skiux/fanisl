import { buildSnapshot, balances, positions } from './fixtures'
import { PortfolioError, type PortfolioSnapshot, type VenueState } from './types'

/**
 * Mock 客户端。真后端落地后整个文件被一个 fetch 包装替换，
 * 上层组件不需要改——它们只认 PortfolioSnapshot。
 *
 * 场景不是为了演示好看，是为了让失败态和成功态一起被设计。
 * 451 在这个项目里是必然会发生的（出口地区受限），不是万一。
 */
export const SCENARIOS = {
  ok: '正常',
  stale: '数据陈旧',
  partial: '合约不可达',
  blocked: '全部不可达',
  unauthorized: 'Key 失效',
  empty: '空账户',
  loading: '加载中',
  down: '后端不可达',
} as const

export type Scenario = keyof typeof SCENARIOS

const STORE_KEY = 'fanisl.console.scenario'

export function readScenario(): Scenario {
  const fromUrl = new URLSearchParams(window.location.search).get('scenario')
  const stored = window.localStorage.getItem(STORE_KEY)
  const value = fromUrl ?? stored ?? 'ok'
  return value in SCENARIOS ? (value as Scenario) : 'ok'
}

export function writeScenario(scenario: Scenario) {
  window.localStorage.setItem(STORE_KEY, scenario)
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000)

const failedVenue = (
  venue: 'spot' | 'futures',
  status: VenueState['status'],
  detail: string,
  asOf: string | null,
): VenueState => ({ venue, status, as_of: asOf, detail })

function scenarioSnapshot(scenario: Scenario): PortfolioSnapshot {
  switch (scenario) {
    case 'stale':
      return buildSnapshot(minutesAgo(214))

    case 'partial': {
      const base = buildSnapshot(minutesAgo(1))
      const spotOnly = base.balances.filter((b) => b.venue === 'spot')
      const spotValue = spotOnly.reduce((total, b) => total + (b.value_usd ?? 0), 0)
      return {
        ...base,
        venues: [
          base.venues[0]!,
          failedVenue('futures', 'unreachable', 'HTTP 451 — fapi.binance.com 拒绝当前出口地区', minutesAgo(96).toISOString()),
        ],
        balances: spotOnly,
        positions: [],
        futures_risk: null,
        totals: {
          equity_usd: spotValue,
          spot_usd: spotValue,
          futures_usd: null,
          unrealized_pnl_usd: null,
          change_24h_usd: null,
          change_24h_pct: null,
        },
      }
    }

    case 'blocked': {
      // 两个来源都断了，但库里还有上次成功的快照。诚实的做法是把它显示出来
      // 并让"过期"变成可感知的材质，而不是假装这是当前余额。
      const cached = buildSnapshot(minutesAgo(842))
      return {
        ...cached,
        venues: [
          failedVenue('spot', 'unreachable', 'HTTP 451 — api.binance.com 拒绝当前出口地区', cached.as_of),
          failedVenue('futures', 'unreachable', 'HTTP 451 — fapi.binance.com 拒绝当前出口地区', cached.as_of),
        ],
      }
    }

    case 'unauthorized':
      return {
        as_of: null,
        base_currency: 'USD',
        venues: [
          failedVenue('spot', 'unauthorized', 'API key 无读取权限，或调用 IP 不在白名单内', null),
          failedVenue('futures', 'unauthorized', 'API key 无读取权限，或调用 IP 不在白名单内', null),
        ],
        totals: null,
        balances: [],
        positions: [],
        futures_risk: null,
      }

    case 'empty': {
      const iso = minutesAgo(1).toISOString()
      return {
        as_of: iso,
        base_currency: 'USD',
        venues: [
          { venue: 'spot', status: 'ok', as_of: iso, detail: null },
          { venue: 'futures', status: 'ok', as_of: iso, detail: null },
        ],
        totals: {
          equity_usd: 0, spot_usd: 0, futures_usd: 0, unrealized_pnl_usd: 0,
          change_24h_usd: null, change_24h_pct: null,
        },
        balances: [],
        positions: [],
        futures_risk: null,
      }
    }

    default:
      return buildSnapshot(minutesAgo(1))
  }
}

export async function fetchPortfolio(
  scenario: Scenario,
  signal?: AbortSignal,
): Promise<PortfolioSnapshot> {
  if (scenario === 'loading') {
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })
  }

  await new Promise((resolve) => setTimeout(resolve, 420))
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  if (scenario === 'down') {
    throw new PortfolioError('network', '连不上 fanisl 后端（127.0.0.1:8000）')
  }
  return scenarioSnapshot(scenario)
}

export { balances, positions }
