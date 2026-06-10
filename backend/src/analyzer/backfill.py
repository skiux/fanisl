"""历史回填：把过去的行情/衍生品/情绪一次性拉进时间序列库。

与每 15min 的前向采集互补——前向只从启动那刻起累积；回填让 get_metric_history / 数据页
**立刻有纵深**。按每根历史 K 线算整条指标序列、按各自时间戳落库；funding / 恐惧贪婪取各自
可得的历史。幂等（ON CONFLICT 覆盖），可重复跑。

运行：`python -m analyzer.backfill`            # 默认 watchlist + 1w/1d/4h/1h
      `python -m analyzer.backfill BTC/USDT ETH/USDT --tf 1d 4h --limit 1500`
"""

from __future__ import annotations

import sys

import pandas as pd

from .data.instruments import Resolver
from .indicators.compute import indicator_series
from .marketstore import GLOBAL, MarketStore

_BACKFILL_TFS = ["1w", "1d", "4h", "1h"]  # 默认回填周期（深度好、性价比高；日内留给前向采集）
_DEFAULT_LIMIT = 1500


def _emit(rows: list, scope: str, symbol: str, metric: str, ts_series, val_series) -> None:
    for t, v in zip(ts_series, val_series):
        if v is not None and pd.notna(v):
            rows.append((scope, symbol, metric, t.isoformat(), float(v)))


# 预热段：MACD(26+9)/RSI(14) 等基于 ewm 的指标开头若干根不稳定（会出 RSI=0/100 伪值），
# 整条序列回填时把这段丢掉。快照路径只取最后一根、本就不受影响。
_WARMUP = 35


def indicator_rows(symbol: str, tf: str, df: pd.DataFrame, *, with_price: bool) -> list[tuple]:
    """一份历史 OHLCV → 该周期的历史指标样本（与 flatten 同名，带 _{tf} 后缀）。

    指标集合与算法由 `indicator_series` 单一定义（与快照共用），这里只负责加 _{tf} 后缀、
    丢预热段、按时间戳落库。
    """
    closed = df.iloc[:-1]  # 丢掉未收盘那根（与 compute_indicators 一致）
    if len(closed) < _WARMUP + 5:
        return []
    ts = closed["ts"]
    t = ts.iloc[_WARMUP:]  # 全部指标都从预热段之后开始落库

    rows: list[tuple] = []

    def emit(metric: str, series) -> None:
        _emit(rows, "symbol", symbol, metric, t, series.iloc[_WARMUP:])

    for base, series in indicator_series(closed).items():
        emit(f"{base}_{tf}", series)
    if with_price:  # price 只从最细周期出一条干净连续的序列
        emit("price", closed["close"])
    return rows


# 有可得历史的衍生品时点指标（Binance fapiData，~20 天）
_DERIV_METRICS = ["open_interest_usd", "lsr", "top_trader_lsr", "taker_buy_sell_ratio"]


def _deriv_rows(symbol: str, source) -> list[tuple]:
    rows: list[tuple] = []
    for m in _DERIV_METRICS:
        for h in source.fetch_deriv_history(symbol, m):
            rows.append(("symbol", symbol, m, h["ts"], h["value"]))
    return rows


def _onchain_symbol_rows(symbol: str, base: str, sentiment, catalysts) -> list[tuple]:
    """某标的的链上 + 解锁历史（链 TVL / BTC 网络使用度 / 已发生的解锁）。"""
    rows: list[tuple] = []
    tvl_src = getattr(sentiment, "chain_tvl", None) if sentiment else None
    if tvl_src is not None:
        for h in tvl_src.fetch_chain_tvl_history(base):
            rows.append(("symbol", symbol, "chain_tvl", h["ts"], h["value"]))
    net_src = getattr(sentiment, "network", None) if sentiment else None
    if net_src is not None and hasattr(net_src, "fetch_network_history"):
        for metric, series in net_src.fetch_network_history(base).items():
            for h in series:
                rows.append(("symbol", symbol, metric, h["ts"], h["value"]))
    unlock_src = getattr(catalysts, "unlocks", None) if catalysts else None
    if unlock_src is not None and hasattr(unlock_src, "fetch_unlock_history"):
        for h in unlock_src.fetch_unlock_history(symbol):
            rows.append(("symbol", symbol, "unlock_tokens", h["ts"], h["tokens"]))
    return rows


def backfill_symbol(
    symbol: str, timeframes: list[str], limit: int, store: MarketStore,
    resolver: Resolver, sentiment=None, catalysts=None,
) -> int:
    r = resolver.resolve(symbol)
    base = symbol.split("/")[0].split(":")[0].upper()
    price_tf = timeframes[-1]
    total = 0
    for tf in timeframes:
        try:
            df = r.source.fetch_ohlcv(r.provider_symbol, tf, limit)
        except Exception as e:  # noqa: BLE001
            print(f"  {symbol:12s} {tf:4s} OHLCV 失败: {str(e)[:50]}")
            continue
        rows = indicator_rows(symbol, tf, df, with_price=(tf == price_tf))
        n = store.write_history(rows)
        total += n
        span = f"{df['ts'].iloc[0].date()}→{df['ts'].iloc[-1].date()}" if len(df) else "-"
        print(f"  {symbol:12s} {tf:4s} {n:6d} 行  {span}")
    # 资金费率 + 衍生品时点历史（仅永续）
    if r.supports_derivatives and hasattr(r.source, "fetch_funding_history"):
        fh = r.source.fetch_funding_history(r.provider_symbol)
        frows = [("symbol", symbol, "funding_rate", h["ts"], h["value"]) for h in fh]
        drows = _deriv_rows(symbol, r.source)
        n = store.write_history(frows) + store.write_history(drows)
        total += n
        if n:
            print(f"  {symbol:12s} 衍生品 funding {len(frows)} + OI/LSR/taker {len(drows)} 行")
    # 链上 + 解锁
    orows = _onchain_symbol_rows(symbol, base, sentiment, catalysts)
    if orows:
        total += store.write_history(orows)
        print(f"  {symbol:12s} 链上/解锁 {len(orows):6d} 行")
    return total


def backfill_global(store: MarketStore, sentiment, catalysts) -> int:
    """全市场维度：恐惧贪婪 + 稳定币供应 + FRED 宏观数值（都 scope=GLOBAL）。"""
    total = 0
    fg = getattr(sentiment, "fear_greed", None) if sentiment else None
    if fg is not None and hasattr(fg, "fetch_history"):
        rows = [("global", GLOBAL, "fear_greed", h["ts"], h["value"]) for h in fg.fetch_history(limit=0)]
        total += store.write_history(rows)
        print(f"  GLOBAL       fear_greed {len(rows):6d} 行")
    sc = getattr(sentiment, "stablecoins", None) if sentiment else None
    if sc is not None and hasattr(sc, "fetch_stablecoin_history"):
        rows = [("global", GLOBAL, "stablecoin_total", h["ts"], h["value"]) for h in sc.fetch_stablecoin_history()]
        total += store.write_history(rows)
        print(f"  GLOBAL       stablecoin_total {len(rows):6d} 行")
    macro = getattr(catalysts, "macro", None) if catalysts else None
    if macro is not None and hasattr(macro, "fetch_series_history"):
        from .data.fred_source import FRED_SERIES
        for sid, metric, units in FRED_SERIES:
            rows = [("global", GLOBAL, metric, h["ts"], h["value"])
                    for h in macro.fetch_series_history(sid, units)]
            if rows:
                total += store.write_history(rows)
                print(f"  GLOBAL       {metric:20s} {len(rows):6d} 行")
    return total


def run_backfill(symbols, timeframes, limit, store, resolver, sentiment, catalysts=None) -> int:
    print(f"回填开始：{len(symbols)} 个标的 × {timeframes}，每周期 ≤{limit} 根")
    total = 0
    for sym in symbols:
        total += backfill_symbol(sym, timeframes, limit, store, resolver, sentiment, catalysts)
    total += backfill_global(store, sentiment, catalysts)
    print(f"回填完成：共写入 {total} 行")
    return total


def main() -> None:
    from . import runtime as rt

    args = [a for a in sys.argv[1:]]
    timeframes = list(_BACKFILL_TFS)
    limit = _DEFAULT_LIMIT
    if "--tf" in args:
        i = args.index("--tf")
        timeframes = args[i + 1:]
        args = args[:i]
    if "--limit" in args:
        i = args.index("--limit")
        limit = int(args[i + 1])
        args = args[:i] + args[i + 2:]
    symbols = args or list(rt.settings.watchlist)
    run_backfill(symbols, timeframes, limit, rt.market_store, rt.resolver, rt.sentiment, rt.catalysts)
    rt.pool.close()
    rt.trading_pool.close()


if __name__ == "__main__":
    main()
