"""组装 `/ledger`，形状对齐 console 契约的 LedgerSnapshot。

**Binance 没有统一的流水接口。** 这条时间线是八个端点各拉一段合并出来的，
所以每条记录都必须带着自己的出处（`source`），而每个端点的窗口上限还不一样。

由此得到两条决定这一页形状的结论，都要如实报给前端：
- **单次能查的上限 = 各来源上限的交集 = 30 天**，卡在理财派息/杠杆利息/闪兑三个。
- **刷一次不是免费的**：划转必须按 type 逐个问，提现单次权重 18000（10 次/秒）。
  界面上那格"取数成本"就是这么算出来的。

几个只有读文档才知道的坑（都写了测试盯着）：
- 提现历史的 `applyTime` 是**字符串** "2026-08-25 10:00:00"，不是毫秒时间戳。
- 杠杆利息那个字段官方拼错成 `interestAccuredTime`（少个 c），照着写才取得到。
- 闪兑返回的是 `list` 不是 `rows`，小额兑换是 `userAssetDribblets`——三个端点三种壳。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from .cache import SourceCache, fetch_all
from .client import BinanceClient
from .common import dec, dec0, guard, ms_to_iso, price_map, usd_value

MS_DAY = 86_400_000

GROUP_OF = {
    "deposit": "external", "withdraw": "external",
    "realized_pnl": "income", "funding_fee": "income", "commission": "income",
    "insurance_clear": "income", "referral_kickback": "income",
    "earn_reward": "income", "margin_interest": "income",
    "transfer": "internal", "convert": "internal", "dust": "internal",
}

# 划转必须按 type 逐个问。官方枚举约 40 种，这里只问**这个账户可能用到的 12 种**——
# 全问一遍是 40 次调用，而其中大半（期权、币本位各种组合）对这个账户恒为空。
# 少问的代价写在 fanout 里，界面上看得到。
TRANSFER_TYPES = [
    "MAIN_UMFUTURE", "UMFUTURE_MAIN",
    "MAIN_CMFUTURE", "CMFUTURE_MAIN",
    "MAIN_MARGIN", "MARGIN_MAIN",
    "MAIN_FUNDING", "FUNDING_MAIN",
    "UMFUTURE_MARGIN", "MARGIN_UMFUTURE",
    "FUNDING_UMFUTURE", "UMFUTURE_FUNDING",
]

_TRANSFER_WALLET = {
    "MAIN": "spot", "UMFUTURE": "usdm_futures", "CMFUTURE": "coinm_futures",
    "MARGIN": "cross_margin", "ISOLATEDMARGIN": "isolated_margin",
    "FUNDING": "funding", "OPTION": "options",
}

_INCOME_KIND = {
    "REALIZED_PNL": "realized_pnl", "FUNDING_FEE": "funding_fee",
    "COMMISSION": "commission", "INSURANCE_CLEAR": "insurance_clear",
    "REFERRAL_KICKBACK": "referral_kickback", "COMMISSION_REBATE": "referral_kickback",
}

# 每个来源自己的窗口限制与取数代价。这是**页面内容**，不是脚注——
# "为什么只能看 30 天"和"刷一次多贵"都由它回答。数字来自官方文档（2026-08 复核）。
# 每个来源的窗口上限与权重。**这份表不出接口**——它曾经作为 `windows` 字段返回，
# 界面上画成一张「取数窗口」的端点清单。那是接口的构造，属于 README 不属于页面
# （2026-09-04 删）。这里留着是因为 MAX_WINDOW_DAYS / NEVER_FORCE 从它推出来。
WINDOWS: list[dict] = [
    {"key": "deposits", "endpoint": "GET /sapi/v1/capital/deposit/hisrec",
     "weight": 1, "max_window_days": 90, "lookback_days": 90, "fanout": None, "calls": 1},
    {"key": "withdrawals", "endpoint": "GET /sapi/v1/capital/withdraw/history",
     "weight": 18000, "max_window_days": 90, "lookback_days": 90,
     "fanout": "账户维度限速 10 次/秒", "calls": 1},
    {"key": "income", "endpoint": "GET /fapi/v1/income",
     "weight": 30, "max_window_days": None, "lookback_days": 90, "fanout": None, "calls": 1},
    {"key": "wallet_transfers", "endpoint": "GET /sapi/v1/asset/transfer",
     "weight": 1, "max_window_days": None, "lookback_days": 180,
     "fanout": f"type 必填，实取 {len(TRANSFER_TYPES)} 种常用", "calls": len(TRANSFER_TYPES)},
    {"key": "earn_rewards",
     "endpoint": "GET /sapi/v1/simple-earn/flexible/history/rewardsRecord",
     "weight": 150, "max_window_days": 30, "lookback_days": None,
     "fanout": "flexible 与 locked 分开两次", "calls": 2},
    {"key": "margin_interest", "endpoint": "GET /sapi/v1/margin/interestHistory",
     "weight": 1, "max_window_days": 30, "lookback_days": 90, "fanout": None, "calls": 1},
    {"key": "convert", "endpoint": "GET /sapi/v1/convert/tradeFlow",
     "weight": 3000, "max_window_days": 30, "lookback_days": None,
     "fanout": "起止时间都必填", "calls": 1},
    {"key": "dust", "endpoint": "GET /sapi/v1/asset/dribblet",
     "weight": 1, "max_window_days": None, "lookback_days": None, "fanout": None, "calls": 1},
]

_CAPPED = [w for w in WINDOWS if w["max_window_days"] is not None]
MAX_WINDOW_DAYS = min(w["max_window_days"] for w in _CAPPED)
LIMITED_BY = min(_CAPPED, key=lambda w: w["max_window_days"])["key"]

# 与 /portfolio 一致：贵的来源不让"重新取数"穿透
NEVER_FORCE = frozenset({"ledger.withdrawals", "ledger.convert"})

TTL = {"cheap": 300, "expensive": 900}


def _entry(kind: str, source: str, time: str | None, asset: str, amount: float,
           prices: dict[str, float], **extra: Any) -> dict:
    return {
        "id": extra.pop("id", f"{source}:{extra.get('tx_id') or time}:{asset}"),
        "kind": kind, "group": GROUP_OF[kind], "source": source,
        "time": time, "asset": asset, "symbol": extra.pop("symbol", None),
        "amount": amount, "value_usd": usd_value(asset, amount, prices),
        "wallet": extra.pop("wallet", None), "counterparty": extra.pop("counterparty", None),
        "from_asset": extra.pop("from_asset", None),
        "from_amount": extra.pop("from_amount", None),
        "from_value_usd": extra.pop("from_value_usd", None),
        "network": extra.pop("network", None), "tx_id": extra.pop("tx_id", None),
        "status": extra.pop("status", "confirmed"),
    }


def _apply_time_to_iso(value: Any) -> str | None:
    """提现历史的 applyTime 是**字符串** "2026-08-25 10:00:00"，不是毫秒时间戳。

    当成毫秒去解析会得到 1970 年，整段提现记录排到时间线最底下、日期还全错。
    """
    if value is None:
        return None
    if isinstance(value, (int, float)) or str(value).isdigit():
        return ms_to_iso(value)
    try:
        return datetime.strptime(str(value), "%Y-%m-%d %H:%M:%S").replace(
            tzinfo=timezone.utc).isoformat()
    except ValueError:
        return None


def _deposits(rows: Any, prices: dict[str, float]) -> list[dict]:
    out = []
    for row in rows or []:
        if int(row.get("status", 0)) != 1:      # 只算已到账
            continue
        asset = row.get("coin", "")
        out.append(_entry("deposit", "deposits", ms_to_iso(row.get("insertTime")),
                          asset, dec0(row.get("amount")), prices,
                          network=row.get("network"), tx_id=row.get("txId"),
                          wallet="spot"))
    return out


def _withdrawals(rows: Any, prices: dict[str, float]) -> list[dict]:
    out = []
    for row in rows or []:
        if int(row.get("status", 0)) != 6:      # 6 = Completed
            continue
        asset = row.get("coin", "")
        out.append(_entry("withdraw", "withdrawals",
                          _apply_time_to_iso(row.get("completeTime") or row.get("applyTime")),
                          asset, -dec0(row.get("amount")), prices,
                          network=row.get("network"), tx_id=row.get("txId"),
                          wallet="spot"))
    return out


def _income(rows: Any, prices: dict[str, float]) -> list[dict]:
    out = []
    for row in rows or []:
        kind = _INCOME_KIND.get(row.get("incomeType", ""))
        if kind is None:
            continue                            # TRANSFER 之类不是损益，不进流水的收支类
        asset = row.get("asset", "USDT")
        out.append(_entry(kind, "income", ms_to_iso(row.get("time")), asset,
                          dec0(row.get("income")), prices,
                          id=f"income:{row.get('tranId')}",
                          symbol=row.get("symbol") or None, wallet="usdm_futures"))
    return out


def _transfers(by_type: dict[str, Any], prices: dict[str, float]) -> list[dict]:
    out = []
    for kind, payload in by_type.items():
        rows = (payload or {}).get("rows", []) if isinstance(payload, dict) else []
        src, _, dst = kind.partition("_")
        for row in rows:
            asset = row.get("asset", "")
            # 划转记的是"搬了多少"，不是"少了多少"——它不改变净值
            out.append(_entry("transfer", "wallet_transfers",
                              ms_to_iso(row.get("timestamp")), asset,
                              dec0(row.get("amount")), prices,
                              id=f"transfer:{row.get('tranId')}",
                              wallet=_TRANSFER_WALLET.get(src),
                              counterparty=_TRANSFER_WALLET.get(dst),
                              status="confirmed" if row.get("status") == "CONFIRMED"
                                     else "pending"))
    return out


def _earn_rewards(flexible: Any, locked: Any, prices: dict[str, float]) -> list[dict]:
    out = []
    for row in (flexible or {}).get("rows", []) if isinstance(flexible, dict) else []:
        asset = row.get("asset", "")
        out.append(_entry("earn_reward", "earn_rewards", ms_to_iso(row.get("time")),
                          asset, dec0(row.get("rewards")), prices, wallet="earn"))
    for row in (locked or {}).get("rows", []) if isinstance(locked, dict) else []:
        asset = row.get("asset", "")
        out.append(_entry("earn_reward", "earn_rewards", ms_to_iso(row.get("time")),
                          asset, dec0(row.get("amount")), prices, wallet="earn"))
    return out


def _margin_interest(payload: Any, prices: dict[str, float]) -> list[dict]:
    rows = (payload or {}).get("rows", []) if isinstance(payload, dict) else []
    out = []
    for row in rows:
        asset = row.get("asset", "")
        # 官方把这个字段拼错成 interestAccuredTime（少个 c），照着写才取得到
        at = row.get("interestAccuredTime") or row.get("interestAccruedTime")
        out.append(_entry("margin_interest", "margin_interest", ms_to_iso(at), asset,
                          -dec0(row.get("interest")), prices,   # 利息是成本，记负
                          id=f"interest:{row.get('txId')}", wallet="cross_margin"))
    return out


def _convert(payload: Any, prices: dict[str, float]) -> list[dict]:
    rows = (payload or {}).get("list", []) if isinstance(payload, dict) else []
    out = []
    for row in rows:
        if row.get("orderStatus") != "SUCCESS":
            continue
        to_asset, from_asset = row.get("toAsset", ""), row.get("fromAsset", "")
        from_amount = -dec0(row.get("fromAmount"))
        out.append(_entry("convert", "convert", ms_to_iso(row.get("createTime")),
                          to_asset, dec0(row.get("toAmount")), prices,
                          id=f"convert:{row.get('orderId')}",
                          from_asset=from_asset, from_amount=from_amount,
                          from_value_usd=usd_value(from_asset, from_amount, prices),
                          wallet="spot"))
    return out


def _dust(payload: Any, prices: dict[str, float]) -> list[dict]:
    rows = ((payload or {}).get("userAssetDribblets", [])
            if isinstance(payload, dict) else [])
    out = []
    for row in rows:
        details = row.get("userAssetDribbletDetails") or []
        got = dec0(row.get("totalTransferedAmount"))
        out.append(_entry("dust", "dust", ms_to_iso(row.get("operateTime")), "BNB",
                          got, prices, id=f"dust:{row.get('transId')}",
                          from_asset=f"{len(details)} 种小额资产",
                          # 换出去那一侧是多个币种，没有单一数量可填——留 null 而不是编一个
                          from_amount=None, from_value_usd=None, wallet="spot"))
    return out


def _ensure_unique_ids(entries: list[dict]) -> None:
    """保证 id 全局唯一。

    有自然主键的（tranId / txId / orderId / positionId）直接用；剩下几类只能靠
    来源+时刻+资产拼，理论上会撞——同一资产在同一时刻的两条理财派息就是一例。
    前端拿 id 当 React key，撞了不会报错，只会**渲染错行**，是那种看着正常的错。
    """
    seen: dict[str, int] = {}
    for entry in entries:
        base = entry["id"]
        n = seen.get(base, 0)
        seen[base] = n + 1
        if n:
            entry["id"] = f"{base}#{n}"


def build_ledger(client: BinanceClient, cache: SourceCache, *, days: int = 7,
                 force: bool = False, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    days = max(1, min(days, MAX_WINDOW_DAYS))
    end_ms = int(now.timestamp() * 1000)
    start_ms = end_ms - days * MS_DAY
    tag = f"{days}d"

    jobs: list[tuple[str, int, Callable[[], Any]]] = [
        ("prices", 30, client.spot_prices),
        (f"ledger.deposits:{tag}", TTL["cheap"],
         lambda: client.deposits(start_ms=start_ms, end_ms=end_ms)),
        (f"ledger.withdrawals:{tag}", TTL["expensive"],
         lambda: client.withdrawals(start_ms=start_ms, end_ms=end_ms)),
        (f"ledger.income:{tag}", TTL["cheap"],
         lambda: client.futures_income(start_ms=start_ms, end_ms=end_ms)),
        (f"ledger.earn_flex:{tag}", TTL["cheap"],
         lambda: client.earn_flexible_rewards(start_ms=start_ms, end_ms=end_ms)),
        (f"ledger.earn_locked:{tag}", TTL["cheap"],
         lambda: client.earn_locked_rewards(start_ms=start_ms, end_ms=end_ms)),
        (f"ledger.interest:{tag}", TTL["cheap"],
         lambda: client.margin_interest_history(start_ms=start_ms, end_ms=end_ms)),
        (f"ledger.convert:{tag}", TTL["expensive"],
         lambda: client.convert_trade_flow(start_ms=start_ms, end_ms=end_ms)),
        (f"ledger.dust:{tag}", TTL["cheap"],
         lambda: client.dust_log(start_ms=start_ms, end_ms=end_ms)),
    ]
    # 划转按 type 逐个问，每种一个缓存键——某一种挂了不影响其余
    for kind in TRANSFER_TYPES:
        jobs.append((f"ledger.transfer:{kind}:{tag}", TTL["cheap"],
                     (lambda k=kind: client.universal_transfers(
                         k, start_ms=start_ms, end_ms=end_ms))))

    results = fetch_all(cache, jobs, force=force,
                        never_force=frozenset(f"{k}:{tag}" for k in NEVER_FORCE))

    def payload(key: str) -> Any:
        got = results.get(key)
        return got.payload if got else None

    prices = price_map(payload("prices"))
    transfer_payloads = {k: payload(f"ledger.transfer:{k}:{tag}") for k in TRANSFER_TYPES}

    # 每一类单独装配：一类形状变了只带走那一类（同 portfolio 的理由）
    errors: dict[str, str] = {}

    def parse(key: str, fn) -> list[dict]:
        value, error = guard(key, fn, fallback=[])
        if error:
            errors[key] = error
        return value or []

    entries: list[dict] = []
    entries += parse("deposits", lambda: _deposits(payload(f"ledger.deposits:{tag}"), prices))
    entries += parse("withdrawals",
                     lambda: _withdrawals(payload(f"ledger.withdrawals:{tag}"), prices))
    entries += parse("income", lambda: _income(payload(f"ledger.income:{tag}"), prices))
    entries += parse("wallet_transfers", lambda: _transfers(transfer_payloads, prices))
    entries += parse("earn_rewards", lambda: _earn_rewards(
        payload(f"ledger.earn_flex:{tag}"), payload(f"ledger.earn_locked:{tag}"), prices))
    entries += parse("margin_interest",
                     lambda: _margin_interest(payload(f"ledger.interest:{tag}"), prices))
    entries += parse("convert", lambda: _convert(payload(f"ledger.convert:{tag}"), prices))
    entries += parse("dust", lambda: _dust(payload(f"ledger.dust:{tag}"), prices))
    entries.sort(key=lambda e: e["time"] or "", reverse=True)
    _ensure_unique_ids(entries)

    # 划转的状态取这 12 次调用里最坏的那个：只要有一种没问到，这一类就是不完整的
    transfer_results = [results[f"ledger.transfer:{k}:{tag}"] for k in TRANSFER_TYPES]
    worst_transfer = next((r for r in transfer_results if not r.ok), transfer_results[0])

    source_of = {
        "deposits": results[f"ledger.deposits:{tag}"],
        "withdrawals": results[f"ledger.withdrawals:{tag}"],
        "income": results[f"ledger.income:{tag}"],
        "wallet_transfers": worst_transfer,
        "earn_rewards": results[f"ledger.earn_flex:{tag}"],
        "margin_interest": results[f"ledger.interest:{tag}"],
        "convert": results[f"ledger.convert:{tag}"],
        "dust": results[f"ledger.dust:{tag}"],
    }
    states = [{"key": key, "status": r.status,
               "as_of": r.as_of.isoformat() if r.as_of else None,
               "detail": r.detail}
              for key, r in source_of.items()]
    for state in states:
        if state["status"] == "ok" and state["key"] in errors:
            state["status"] = "unsupported"
            state["detail"] = errors[state["key"]]
    fresh = [datetime.fromisoformat(s["as_of"]) for s in states
             if s["status"] == "ok" and s["as_of"]]

    return {
        "as_of": min(fresh).isoformat() if fresh else None,
        "sources": states,
        "window": {
            "from": datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc).isoformat(),
            "to": now.isoformat(), "days": days,
            "max_days": MAX_WINDOW_DAYS, "limited_by": LIMITED_BY,
        },
        "entries": entries,
    }
