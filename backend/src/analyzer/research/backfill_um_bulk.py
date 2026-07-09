"""回填 Binance USDT-M 永续的 bulk 历史（data.binance.vision，API 被 451 但 CDN 可达）。

供 H21（宽 universe 资金费 carry）：
- fundingRate 月度档：**逐次结算**（8h 一行，fraction）→ metric='um_funding_8h'，
  ts=结算时刻（calc_time）。比 Coinalyze 日线 close×3 近似精确。
- klines 1d 月度档：日线收盘 → metric='um_close_1d'，ts=open+24h（收盘戳）。
- **universe（锁定规则）= 资金费历史起点 ≤ 2021-12 的全部符号（147 个，含退市：
  LUNA/SRM 等）**——PIT 可用性由数据存在性天然给出，修掉幸存者偏差。
- symbol 用原始 'BTCUSDT' 形式（自成一套，不与 canonical 'BTC/USDT' 的 price 混存）。

跑：`python -m analyzer.research.backfill_um_bulk [--limit N]`（幂等，可重跑续填）。
"""

from __future__ import annotations

import io
import re
import sys
import time
import zipfile
from collections import defaultdict

import httpx

from ..config import get_settings
from ..db import make_pool
from ..marketstore import MarketStore

S3 = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
CDN = "https://data.binance.vision"
FUND_PREFIX = "data/futures/um/monthly/fundingRate/"
UNIVERSE_START_CUTOFF = "2021-12"   # 资金费起点 ≤ 此月 → 入 universe（锁定）
SLEEP_S = 0.08
RETRIES = 3


def _get(url: str, params: dict | None = None) -> httpx.Response | None:
    for attempt in range(RETRIES + 1):
        try:
            r = httpx.get(url, params=params, timeout=30)
            if r.status_code == 404:
                return None                      # 该月无档（上市前/退市后）→ 跳过
            r.raise_for_status()
            return r
        except httpx.HTTPError:
            if attempt == RETRIES:
                raise
            time.sleep(3.0 * (attempt + 1))
    return None


def list_funding_inventory() -> dict[str, list[str]]:
    """S3 列表分页枚举全部 fundingRate 月度 zip：symbol → [YYYY-MM…]（升序）。"""
    months: dict[str, list[str]] = defaultdict(list)
    marker = ""
    while True:
        r = _get(S3, {"prefix": FUND_PREFIX, "marker": marker})
        keys = re.findall(r"<Key>([^<]+)</Key>", r.text)
        for k in keys:
            m = re.match(r".*/fundingRate/([A-Z0-9_]+)/\1-fundingRate-(\d{4}-\d{2})\.zip$", k)
            if m:
                months[m.group(1)].append(m.group(2))
        if "<IsTruncated>true</IsTruncated>" not in r.text or not keys:
            break
        marker = keys[-1]
        time.sleep(SLEEP_S)
    return {s: sorted(v) for s, v in months.items()}


def _csv_rows(content: bytes) -> list[list[str]]:
    """zip 里唯一 CSV 的数据行（首字段非数字的行 = 表头，跳过）。"""
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        raw = z.read(z.namelist()[0]).decode()
    rows = []
    for line in raw.splitlines():
        parts = line.split(",")
        if parts and parts[0].strip().isdigit():
            rows.append(parts)
    return rows


def _ms_iso(ms: int) -> str:
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).isoformat()


def fetch_month(sym: str, month: str) -> tuple[list[tuple], list[tuple]]:
    """一个 symbol-month 的 (funding rows, close rows)，任一档缺失则该档为空。"""
    frows: list[tuple] = []
    fr = _get(f"{CDN}/{FUND_PREFIX}{sym}/{sym}-fundingRate-{month}.zip")
    if fr is not None:
        for p in _csv_rows(fr.content):
            # calc_time, funding_interval_hours, last_funding_rate（fraction）
            frows.append(("symbol", sym, "um_funding_8h", _ms_iso(int(p[0])), float(p[2])))
    krows: list[tuple] = []
    kr = _get(f"{CDN}/data/futures/um/monthly/klines/{sym}/1d/{sym}-1d-{month}.zip")
    if kr is not None:
        for p in _csv_rows(kr.content):
            # open_time,o,h,l,c,... → ts=open+24h（收盘戳）
            krows.append(("symbol", sym, "um_close_1d", _ms_iso(int(p[0]) + 86_400_000), float(p[4])))
    return frows, krows


def _load_symbol(sym: str, months: list[str], store: MarketStore) -> tuple[int, int]:
    frows_all: list[tuple] = []
    krows_all: list[tuple] = []
    for month in months:
        frows, krows = fetch_month(sym, month)
        frows_all += frows
        krows_all += krows
        time.sleep(SLEEP_S)
    return store.write_history(frows_all), store.write_history(krows_all)


def main() -> None:
    from concurrent.futures import ThreadPoolExecutor, as_completed

    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    inv = list_funding_inventory()
    uni = {s: v for s, v in inv.items() if v and v[0] <= UNIVERSE_START_CUTOFF}
    syms = sorted(uni)[:limit] if limit else sorted(uni)
    print(f"universe（起点≤{UNIVERSE_START_CUTOFF}）= {len(uni)} 符号；本次回填 {len(syms)} 个", flush=True)

    pool = make_pool(get_settings().pg_conninfo)
    store = MarketStore(pool)
    try:
        total_f = total_k = done = 0
        # 按符号并行（8 线程）：写库走连接池（线程安全），单线程内月度串行 + sleep
        with ThreadPoolExecutor(max_workers=8) as ex:
            futs = {ex.submit(_load_symbol, s, uni[s], store): s for s in syms}
            for fut in as_completed(futs):
                sym = futs[fut]
                nf, nk = fut.result()
                total_f += nf
                total_k += nk
                done += 1
                print(f"  [{done}/{len(syms)}] {sym:<14} funding {nf:>6} 行  close {nk:>5} 行"
                      f"  [{uni[sym][0]}→{uni[sym][-1]}]", flush=True)
                if nf == 0 and nk == 0:
                    print(f"    警告：{sym} 0 行（连续 404？）", flush=True)
        print(f"合计 funding {total_f} 行 + close {total_k} 行", flush=True)
    finally:
        pool.close()


if __name__ == "__main__":
    main()
