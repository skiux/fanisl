"""CCXT 数据源：可配置交易所，默认 OKX（Binance 在部分地区被封锁）。

统一拿 永续 OHLCV + 资金费率 + 未平仓量；多空比走各所专用端点（OKX rubik /
Binance futures-data），包在这里对上层透明。用户/Claude 传 'BTC/USDT'，内部解析成
该所的线性永续合约符号（OKX 上是 'BTC/USDT:USDT'，binanceusdm 上仍是 'BTC/USDT'）。
衍生品三项全部 best-effort：任何失败都返回 None，绝不让整次取数崩掉。
"""

from __future__ import annotations

import time
from typing import Callable, TypeVar

import ccxt
import pandas as pd

from .base import OHLCV_COLS, DataSourceError, MarketDataSource, SymbolNotFound

T = TypeVar("T")



class CCXTSource(MarketDataSource):
    supports_derivatives = True  # 永续合约：有资金费率/未平仓量/多空比

    def __init__(self, exchange_id: str = "okx") -> None:
        if not hasattr(ccxt, exchange_id):
            raise DataSourceError(f"CCXT 不支持交易所: {exchange_id}")
        self.name = exchange_id
        self.exchange = getattr(ccxt, exchange_id)({"enableRateLimit": True})
        self._markets_loaded = False

    # --- 基础设施 ---------------------------------------------------------

    def _ensure_markets(self) -> None:
        if not self._markets_loaded:
            self.exchange.load_markets()
            self._markets_loaded = True

    def _perp_symbol(self, symbol: str) -> str:
        """把 'BTC/USDT' 解析成该所的线性 USDT 永续合约统一符号。"""
        self._ensure_markets()
        markets = self.exchange.markets
        if symbol in markets and markets[symbol].get("swap"):
            return symbol
        base, _, rest = symbol.partition("/")
        quote = rest.split(":")[0]
        candidate = f"{base}/{quote}:{quote}"  # 线性永续，如 BTC/USDT:USDT
        if candidate in markets:
            return candidate
        if symbol in markets:
            return symbol  # 退化到现货（该所无对应永续时）
        raise SymbolNotFound(f"{symbol} 在 {self.name} 不存在或不支持")

    @staticmethod
    def _with_retry(fn: Callable[[], T], attempts: int = 2) -> T:
        last: Exception | None = None
        for i in range(attempts + 1):
            try:
                return fn()
            except (ccxt.NetworkError, ccxt.RateLimitExceeded) as e:
                last = e
                time.sleep(0.5 * (2**i))
            except ccxt.BadSymbol as e:
                raise SymbolNotFound(str(e)) from e
            except ccxt.ExchangeError as e:
                raise DataSourceError(str(e)) from e
        raise DataSourceError(f"重试后仍失败: {last}")

    # --- OHLCV（必需）-----------------------------------------------------

    def fetch_ohlcv(self, symbol: str, timeframe: str, limit: int) -> pd.DataFrame:
        sym = self._perp_symbol(symbol)
        raw = self._fetch_ohlcv_raw(sym, timeframe, limit)
        if not raw:
            raise DataSourceError(f"{symbol} {timeframe} 无 K 线数据")
        df = pd.DataFrame(raw, columns=OHLCV_COLS)
        df["ts"] = pd.to_datetime(df["ts"], unit="ms", utc=True)
        for col in OHLCV_COLS[1:]:
            df[col] = df[col].astype(float)
        return df

    def _fetch_ohlcv_raw(self, sym: str, timeframe: str, limit: int) -> list:
        """拉最近 limit 根 K 线。多数所单次上限 300，超过就用 since 向后翻页拼齐。"""
        per_call = 300
        if limit <= per_call:
            return self._with_retry(
                lambda: self.exchange.fetch_ohlcv(sym, timeframe, limit=per_call)
            )
        tf_ms = self.exchange.parse_timeframe(timeframe) * 1000
        now = self.exchange.milliseconds()
        cursor = now - limit * tf_ms
        merged: dict[int, list] = {}
        while cursor < now and len(merged) < limit + per_call:
            batch = self._with_retry(
                lambda c=cursor: self.exchange.fetch_ohlcv(
                    sym, timeframe, since=c, limit=per_call
                )
            )
            if not batch:
                break
            for row in batch:
                merged[row[0]] = row
            nxt = batch[-1][0] + tf_ms
            # 仅在游标无法前进时停（短批次不代表到头——OKX 对 since 锚定请求会回小批，
            # 早停会把游标卡在旧段，导致长周期 tail 取到多年前的旧价）。
            if nxt <= cursor:
                break
            cursor = nxt
        rows = [merged[k] for k in sorted(merged)]
        return rows[-limit:]

    def fetch_ticker(self, symbol: str) -> dict:
        """当前价 + 24h 涨跌幅（给前端价格条用）。优先现货价。"""
        self._ensure_markets()
        sym = symbol if symbol in self.exchange.markets else self._perp_symbol(symbol)
        t = self._with_retry(lambda: self.exchange.fetch_ticker(sym))
        return {
            "symbol": symbol,
            "last": t.get("last"),
            "change_pct_24h": t.get("percentage"),
        }

    # --- 衍生品（best-effort）--------------------------------------------

    def fetch_funding_rate(self, symbol: str) -> dict | None:
        try:
            sym = self._perp_symbol(symbol)
            fr = self._with_retry(lambda: self.exchange.fetch_funding_rate(sym))
            val = fr.get("fundingRate")
            if val is None:
                return None
            val = float(val)
            return {"value": val, "percentile": self._funding_percentile(sym, val)}
        except Exception:
            return None

    def _funding_percentile(self, sym: str, current: float) -> float | None:
        """当前资金费率在近期历史中的分位（0~1），拿不到历史返回 None。"""
        try:
            hist = self._with_retry(
                lambda: self.exchange.fetch_funding_rate_history(sym, limit=100)
            )
            vals = [
                float(h["fundingRate"]) for h in hist if h.get("fundingRate") is not None
            ]
            if len(vals) < 10:
                return None
            return round(sum(1 for v in vals if v < current) / len(vals), 3)
        except Exception:
            return None

    def fetch_open_interest(self, symbol: str) -> dict | None:
        try:
            sym = self._perp_symbol(symbol)
            hist = self._fetch_oi_history(sym)
            if hist:
                last_usd = _oi_usd(hist[-1])
                first_usd = _oi_usd(hist[0])
                change = None
                if last_usd and first_usd:
                    change = (last_usd - first_usd) / first_usd * 100.0
                return {"value_usd": last_usd, "change_24h_pct": change}
            oi = self._with_retry(lambda: self.exchange.fetch_open_interest(sym))
            val = oi.get("openInterestValue") or oi.get("openInterestAmount")
            return {
                "value_usd": float(val) if val is not None else None,
                "change_24h_pct": None,
            }
        except Exception:
            return None

    def _fetch_oi_history(self, sym: str) -> list | None:
        # OKX 的 OI 历史只有用 '1H'（大写）才会被 ccxt 解析成结构化 dict；
        # 传 '1h' 会返回原始数组。其余所（如 binance）用小写 '1h'。
        tf = "1H" if self.name.startswith("okx") else "1h"
        try:
            # 25 根 ≈ 24h+ 窗口，首尾对比算 24h 变化
            return self._with_retry(
                lambda: self.exchange.fetch_open_interest_history(sym, tf, limit=25)
            )
        except Exception:
            return None

    def fetch_long_short_ratio(self, symbol: str) -> dict | None:
        try:
            sym = self._perp_symbol(symbol)
            base = sym.split("/")[0]
            if self.name.startswith("okx"):
                return self._okx_long_short(base)
            if self.name.startswith("binance"):
                return self._binance_long_short(sym)
            return None
        except Exception:
            return None

    def _okx_long_short(self, base: str) -> dict | None:
        method = getattr(
            self.exchange, "publicGetRubikStatContractsLongShortAccountRatio", None
        )
        if method is None:
            return None
        data = self._with_retry(
            lambda: method({"ccy": base, "period": "1H", "limit": "100"})
        )
        rows = data.get("data") if isinstance(data, dict) else data
        return _ratio_with_percentile(rows)

    def _binance_long_short(self, sym: str) -> dict | None:
        mid = self.exchange.market(sym)["id"]  # e.g. BTCUSDT
        return self._binance_ratio_series(
            "fapiDataGetGlobalLongShortAccountRatio", mid, "longShortRatio"
        )

    def _binance_ratio_series(
        self, method_name: str, market_id: str, key: str
    ) -> dict | None:
        """Binance futures-data 比值端点 → {value, percentile}。

        响应是按时间**升序**的 dict 列表（最新在末），取 100 根算当前值的历史分位。
        三个端点同形：全市场多空账户比 / 大户持仓比 / 主动买卖量比。
        """
        method = getattr(self.exchange, method_name, None)
        if method is None:
            return None
        data = self._with_retry(
            lambda: method({"symbol": market_id, "period": "1h", "limit": 100})
        )
        if not data:
            return None
        vals: list[float] = []
        for r in data:
            v = r.get(key)
            if v is not None:
                try:
                    vals.append(float(v))
                except (TypeError, ValueError):
                    pass
        if not vals:
            return None
        current = vals[-1]
        pct = (
            round(sum(1 for v in vals if v < current) / len(vals), 3)
            if len(vals) >= 10
            else None
        )
        return {"value": current, "percentile": pct}

    # --- 大户多空比（聪明钱）---------------------------------------------

    def fetch_top_trader_lsr(self, symbol: str) -> dict | None:
        try:
            sym = self._perp_symbol(symbol)
            if self.name.startswith("binance"):
                # 大户**持仓比**(资金加权)，比账户比更能代表聪明钱的真实仓位
                mid = self.exchange.market(sym)["id"]
                return self._binance_ratio_series(
                    "fapiDataGetTopLongShortPositionRatio", mid, "longShortRatio"
                )
            if self.name.startswith("okx"):
                inst_id = self.exchange.market(sym)["id"]  # e.g. BTC-USDT-SWAP
                method = getattr(
                    self.exchange,
                    "publicGetRubikStatContractsLongShortAccountRatioContractTopTrader",
                    None,
                )
                if method is None:
                    return None
                data = self._with_retry(
                    lambda: method({"instId": inst_id, "period": "1H"})
                )
                rows = data.get("data") if isinstance(data, dict) else data
                return _ratio_with_percentile(rows)  # OKX [[ts, ratio], ...] 最新在前
            return None
        except Exception:
            return None

    # --- 主动买卖量比 (taker buy/sell，仅 Binance) -----------------------

    def fetch_taker_volume(self, symbol: str) -> dict | None:
        """主动成交买卖量比：吃单方向的即时买/卖压力。>1=主动买量更大。"""
        try:
            sym = self._perp_symbol(symbol)
            if not self.name.startswith("binance"):
                return None
            mid = self.exchange.market(sym)["id"]
            return self._binance_ratio_series(
                "fapiDataGetTakerlongshortRatio", mid, "buySellRatio"
            )
        except Exception:
            return None

    # --- 盘口微观结构 (L2 深度快照) -------------------------------------

    def fetch_order_book_stats(self, symbol: str) -> dict | None:
        """L2 盘口 → 价差(bps) + mid 上下 0.5% 内买/卖深度(USD) + 失衡。"""
        try:
            sym = self._perp_symbol(symbol)
            ob = self._with_retry(lambda: self.exchange.fetch_order_book(sym, limit=50))
            bids, asks = ob.get("bids") or [], ob.get("asks") or []
            if not bids or not asks:
                return None
            best_bid, best_ask = float(bids[0][0]), float(asks[0][0])
            if best_bid <= 0 or best_ask <= 0:
                return None
            mid = (best_bid + best_ask) / 2.0
            spread_bps = (best_ask - best_bid) / mid * 1e4
            lo, hi = mid * 0.995, mid * 1.005
            bid_usd = sum(float(p) * float(q) for p, q in bids if float(p) >= lo)
            ask_usd = sum(float(p) * float(q) for p, q in asks if float(p) <= hi)
            tot = bid_usd + ask_usd
            imb = (bid_usd - ask_usd) / tot if tot > 0 else 0.0
            return {
                "mid": mid,
                "spread_bps": round(spread_bps, 3),
                "bid_depth_usd": round(bid_usd, 2),
                "ask_depth_usd": round(ask_usd, 2),
                "imbalance": round(imb, 3),
            }
        except Exception:
            return None

    # --- 基差 / 期限结构 -------------------------------------------------

    def fetch_basis(self, symbol: str) -> dict | None:
        try:
            self._ensure_markets()
            base, _, rest = symbol.partition("/")
            quote = rest.split(":")[0] or "USDT"
            spot_sym = f"{base}/{quote}"
            if spot_sym not in self.exchange.markets:
                return None
            spot = self._with_retry(lambda: self.exchange.fetch_ticker(spot_sym)).get(
                "last"
            )
            perp = self._with_retry(
                lambda: self.exchange.fetch_ticker(self._perp_symbol(symbol))
            ).get("last")
            if not spot or not perp:
                return None
            spot, perp = float(spot), float(perp)
            perp_premium = (perp - spot) / spot * 100.0
            q = self._quarterly_basis(base, quote, spot)
            return {
                "perp_vs_spot_pct": round(perp_premium, 4),
                "quarterly_annualized_pct": q[0] if q else None,
                "quarterly_expiry": q[1] if q else None,
            }
        except Exception:
            return None

    def _quarterly_basis(
        self, base: str, quote: str, spot: float
    ) -> tuple[float, str] | None:
        """最近一个到期的交割合约 → 年化基差(%) + 到期日。无交割合约返回 None。"""
        now = self.exchange.milliseconds()
        futures = [
            m
            for m in self.exchange.markets.values()
            if m.get("future")
            and m.get("base") == base
            and m.get("quote") == quote
            and m.get("expiry")
            and m["expiry"] > now
        ]
        if not futures:
            return None
        nearest = min(futures, key=lambda m: m["expiry"])
        fut = self._with_retry(
            lambda: self.exchange.fetch_ticker(nearest["symbol"])
        ).get("last")
        if not fut:
            return None
        days = (nearest["expiry"] - now) / 86_400_000
        if days <= 0:
            return None
        annualized = (float(fut) / spot - 1.0) * (365.0 / days) * 100.0
        expiry_iso = self.exchange.iso8601(nearest["expiry"])[:10]
        return round(annualized, 2), expiry_iso


def _ratio_with_percentile(rows) -> dict | None:
    """OKX rubik 多空比响应 [[ts, ratio], ...]（最新在前）→ {value, percentile}。

    percentile 是当前值在近期历史中的分位（0~1）；样本不足 10 个则为 None。
    """
    if not rows:
        return None
    vals = [float(r[1]) for r in rows if len(r) > 1]
    if not vals:
        return None
    current = vals[0]
    pct = (
        round(sum(1 for v in vals if v < current) / len(vals), 3)
        if len(vals) >= 10
        else None
    )
    return {"value": current, "percentile": pct}


def _oi_usd(item: dict) -> float | None:
    """从一条 OI 记录里取 USD 名义未平仓量。

    优先用 ccxt 统一字段 openInterestValue（OKX/Binance 都有）；OKX 的 info 是原始
    数组、Binance 的 info 是 dict，所以只有 info 为 dict 时才回退取 sumOpenInterestValue。
    """
    if not isinstance(item, dict):
        return None
    v = item.get("openInterestValue")
    if v is None:
        info = item.get("info")
        if isinstance(info, dict):
            v = info.get("sumOpenInterestValue")
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None
