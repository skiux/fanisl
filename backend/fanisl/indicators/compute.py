"""指标计算：纯函数，输入 OHLCV DataFrame，输出一组指标数值。

不引 pandas-ta（兼容性坑多）；EMA/RSI/MACD/布林/ATR 都用 pandas/numpy 直接实现，
全部隔离在本文件，将来要换库只动这里。无 IO、无副作用，最易测试。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class TFIndicators:
    """单周期算好的全部指标数值（raw，无语义）。"""

    last_price: float
    change_pct: float  # 最新一根相对前一根收盘的涨跌幅

    ema20: float
    ema50: float
    ema200: float

    rsi: float

    macd_line: float
    macd_signal: float
    macd_hist: float
    macd_hist_prev: float  # 用于判断金叉/死叉成形

    bb_upper: float
    bb_mid: float
    bb_lower: float
    bb_width: float
    bb_width_prev: float

    atr: float
    atr_percentile: float  # 0..1，最新 ATR 在近 window 根中的分位

    volume: float
    volume_avg20: float

    recent_swing_high: float
    recent_swing_low: float

    as_of: str = ""  # 最后一根已收盘 K 线的时间（ISO8601），指标算到此为止


# --- 基础指标（返回 Series）---------------------------------------------------


def ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def rma(series: pd.Series, length: int) -> pd.Series:
    """Wilder 平滑（RSI/ATR 用）。"""
    return series.ewm(alpha=1.0 / length, adjust=False).mean()


def rsi(close: pd.Series, length: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = rma(gain, length)
    avg_loss = rma(loss, length)
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    out = 100.0 - 100.0 / (1.0 + rs)
    return out.fillna(100.0)  # 无下跌时 RSI=100


def macd(
    close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9
) -> tuple[pd.Series, pd.Series, pd.Series]:
    macd_line = ema(close, fast) - ema(close, slow)
    signal_line = ema(macd_line, signal)
    hist = macd_line - signal_line
    return macd_line, signal_line, hist


def bollinger(
    close: pd.Series, length: int = 20, mult: float = 2.0
) -> tuple[pd.Series, pd.Series, pd.Series]:
    mid = close.rolling(length).mean()
    std = close.rolling(length).std(ddof=0)
    upper = mid + mult * std
    lower = mid - mult * std
    return upper, mid, lower


def atr(df: pd.DataFrame, length: int = 14) -> pd.Series:
    high, low, close = df["high"], df["low"], df["close"]
    prev_close = close.shift(1)
    tr = pd.concat(
        [(high - low), (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1)
    return rma(tr, length)


# --- 逐周期存库指标的整条序列（回填用；快照取末值用，单一定义避免两处漂移）---------


def indicator_series(closed: pd.DataFrame, atr_percentile_window: int = 100) -> dict:
    """已收盘 OHLCV → {base 名: 整条 Series}。

    这是"哪些逐周期指标入库 + 怎么算"的**单一定义**。key 必须与 metrics.TF_BASES 一致
    （test_metrics 守护）。回填按每根 K 线落库；快照可取 .iloc[-1]。不含 price（=close 本身）。
    """
    close = closed["close"]
    _, _, macd_hist = macd(close)
    bb_upper, _, bb_lower = bollinger(close)
    atr_s = atr(closed)
    return {
        "change_pct": close.pct_change() * 100.0,
        "rsi": rsi(close),
        "macd_hist": macd_hist,
        "atr": atr_s,
        "atr_pct": atr_s.rolling(atr_percentile_window, min_periods=10).apply(
            lambda w: (w[:-1] < w[-1]).mean(), raw=True
        ),
        "vol_ratio": closed["volume"] / closed["volume"].rolling(20).mean(),
        "bb_upper": bb_upper,
        "bb_lower": bb_lower,
    }


# --- 组装 ---------------------------------------------------------------------


def compute_indicators(df: pd.DataFrame, atr_percentile_window: int = 100) -> TFIndicators:
    """从一份 OHLCV DataFrame 算出全部指标。

    关键：交易所返回的最后一根 K 线是**未收盘的当前周期**，成交量只是半截、指标会抖动。
    所以指标全部用「已收盘」K 线计算（丢掉最后一根），但 last_price 取实时价（当前价）。
    需 ≥31 根；EMA200 需 ~600 根才充分收敛（见 config.ohlcv_limit）。
    """
    if len(df) < 31:
        raise ValueError(f"K 线数量不足以计算指标: {len(df)}")

    live_price = float(df["close"].iloc[-1])  # 实时价（含未收盘那根）
    closed = df.iloc[:-1]  # 丢掉未收盘的当前 K 线，下面全用已收盘数据

    close = closed["close"]

    ema20 = ema(close, 20)
    ema50 = ema(close, 50)
    ema200 = ema(close, 200)
    rsi_s = rsi(close)
    macd_line, macd_signal, macd_hist = macd(close)
    bb_upper, bb_mid, bb_lower = bollinger(close)
    bb_width = (bb_upper - bb_lower) / bb_mid
    atr_s = atr(closed)
    vol_avg20 = closed["volume"].rolling(20).mean()

    swing_window = min(20, len(closed))
    recent_high = float(closed["high"].tail(swing_window).max())
    recent_low = float(closed["low"].tail(swing_window).min())

    atr_tail = atr_s.dropna().tail(atr_percentile_window)
    last_atr = float(atr_s.iloc[-1])
    atr_pct = float((atr_tail < last_atr).mean()) if len(atr_tail) > 1 else 0.5

    prev_close = float(close.iloc[-1])  # 最后一根已收盘
    last_price = live_price
    change_pct = (last_price - prev_close) / prev_close * 100.0 if prev_close else 0.0

    as_of = ""
    if "ts" in closed.columns and len(closed):
        try:
            as_of = closed["ts"].iloc[-1].isoformat()
        except Exception:  # noqa: BLE001
            as_of = str(closed["ts"].iloc[-1])

    return TFIndicators(
        last_price=last_price,
        change_pct=change_pct,
        ema20=float(ema20.iloc[-1]),
        ema50=float(ema50.iloc[-1]),
        ema200=float(ema200.iloc[-1]),
        rsi=float(rsi_s.iloc[-1]),
        macd_line=float(macd_line.iloc[-1]),
        macd_signal=float(macd_signal.iloc[-1]),
        macd_hist=float(macd_hist.iloc[-1]),
        macd_hist_prev=float(macd_hist.iloc[-2]),
        bb_upper=float(bb_upper.iloc[-1]),
        bb_mid=float(bb_mid.iloc[-1]),
        bb_lower=float(bb_lower.iloc[-1]),
        bb_width=float(bb_width.iloc[-1]),
        bb_width_prev=float(bb_width.iloc[-2]),
        atr=last_atr,
        atr_percentile=atr_pct,
        volume=float(closed["volume"].iloc[-1]),
        volume_avg20=float(vol_avg20.iloc[-1]),
        recent_swing_high=recent_high,
        recent_swing_low=recent_low,
        as_of=as_of,
    )
