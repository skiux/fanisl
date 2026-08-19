import * as fx from './fixtures'
import {
  PortfolioError,
  type PortfolioSnapshot, type SourceKey, type SourceState, type SourceStatus,
} from './types'

/**
 * Mock 客户端。场景按"哪一组来源挂了"划分，而不是笼统的成功/失败——
 * 451 打在 fapi 上会同时带走合约与收支流水，但现货、理财、快照仍然拿得到。
 */
export const SCENARIOS = {
  ok: '正常',
  stale: '数据陈旧',
  fapi_blocked: '合约域名 451',
  all_blocked: '全部 451',
  no_history: '无历史快照',
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

/** fapi 上的三组：合约账户、维持保证金档位、收支流水。451 一起挂 */
const FAPI_SOURCES: SourceKey[] = ['futures', 'brackets', 'income']

function degrade(
  snapshot: PortfolioSnapshot,
  keys: SourceKey[],
  status: SourceStatus,
  detail: string,
  keepAsOf: string | null,
): SourceState[] {
  return snapshot.sources.map((source) => (
    keys.includes(source.key)
      ? { ...source, status, detail, as_of: keepAsOf }
      : source
  ))
}

function scenarioSnapshot(scenario: Scenario): PortfolioSnapshot {
  switch (scenario) {
    case 'stale':
      return fx.buildSnapshot(minutesAgo(214))

    case 'fapi_blocked': {
      const base = fx.buildSnapshot(minutesAgo(1))
      const equityWithoutFutures = base.wallets
        .filter((bucket) => bucket.kind !== 'usdm_futures' && bucket.kind !== 'coinm_futures')
        .reduce((sum, bucket) => sum + (bucket.value_usd ?? 0), 0)
      return {
        ...base,
        sources: degrade(base, FAPI_SOURCES, 'unreachable',
          'HTTP 451 — fapi.binance.com 拒绝当前出口地区', minutesAgo(96).toISOString()),
        wallets: base.wallets.map((bucket) => (
          bucket.kind === 'usdm_futures' || bucket.kind === 'coinm_futures'
            ? { ...bucket, value_usd: null, btc_valuation: null }
            : bucket
        )),
        futures: null,
        income: null,
        // 合约取不到就没法做归因：缺 realized/funding/commission，恒等式不闭合。
        // 与其给一个残缺的瀑布图，不如明说这一节暂时算不了。
        attribution: null,
        totals: base.totals && {
          ...base.totals,
          equity_usd: equityWithoutFutures,
          gross_exposure_ratio: null,
        },
      }
    }

    case 'all_blocked': {
      const cached = fx.buildSnapshot(minutesAgo(842))
      return {
        ...cached,
        sources: cached.sources.map((source) => ({
          ...source,
          status: 'unreachable' as const,
          detail: 'HTTP 451 — Binance 拒绝当前出口地区',
        })),
      }
    }

    case 'no_history': {
      const base = fx.buildSnapshot(minutesAgo(1))
      return {
        ...base,
        sources: degrade(base, ['snapshots'], 'unreachable', '日快照接口暂时取不到', null),
        equity_curve: [],
        attribution: null,
        totals: base.totals && { ...base.totals, change_24h_usd: null, change_24h_pct: null },
      }
    }

    case 'unauthorized': {
      const iso = null
      return {
        as_of: iso,
        base_currency: 'USD',
        sources: (['wallets', 'spot', 'futures', 'brackets', 'earn', 'margin', 'income', 'transfers', 'snapshots'] as const)
          .map((key) => ({
            key, status: 'unauthorized' as const, as_of: null,
            detail: 'API key 无读取权限，或调用 IP 不在白名单内',
          })),
        totals: null, wallets: [], spot: [], futures: null, earn: [], margin: null,
        income: null, transfers: null, equity_curve: [], attribution: null,
      }
    }

    case 'empty': {
      const iso = minutesAgo(1).toISOString()
      return {
        as_of: iso,
        base_currency: 'USD',
        sources: (['wallets', 'spot', 'futures', 'brackets', 'earn', 'margin', 'income', 'transfers', 'snapshots'] as const)
          .map((key) => fx.okSource(key, iso)),
        totals: { equity_usd: 0, gross_exposure_ratio: null, change_24h_usd: null, change_24h_pct: null },
        wallets: [], spot: [], futures: null, earn: [], margin: null,
        income: null, transfers: null, equity_curve: [], attribution: null,
      }
    }

    default:
      return fx.buildSnapshot(minutesAgo(1))
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
