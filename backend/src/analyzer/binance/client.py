"""Binance 私有接口的签名客户端（只读）。

**为什么不用 ccxt**：ccxt 装着，但它的统一模型会把这一页要的东西抹掉——现货四种锁定态
（free/locked/freeze/withdrawing）、ADL 排队分位、条件单的 workingType/closePosition、
leverageBracket 的维持保证金档位、日快照、理财持仓、小额兑换、闪兑。资产台的契约
（`console/src/api/types.ts`）是**按 Binance 原始字段**写的，绕一层统一模型再拆回来
只会丢字段。签名本身是 40 行 HMAC，自己写更直白。

**三个域名不是一回事**，错误也不一样：
    api.binance.com   现货 /api/v3 与钱包 /sapi/v1
    fapi.binance.com  U 本位合约 /fapi
    dapi.binance.com  币本位合约（暂未用）
用户的网络环境里 451 是**间歇性**的，而且**往往只打在 fapi 上**（见
`~/.claude` 的环境记录与 doc）。所以失败必须按域名/按来源分开记，不能一崩全崩——
这正是前端那套"按来源降级"能成立的前提。
"""

from __future__ import annotations

import time
import urllib.parse
from typing import Any, Literal

import httpx

from .signing import Signer, build_signer

SPOT_BASE = "https://api.binance.com"
FAPI_BASE = "https://fapi.binance.com"

# 与 console 契约里的 SourceStatus 一一对应
ErrorKind = Literal["unauthorized", "unreachable", "rate_limited", "unsupported"]


class BinanceError(Exception):
    def __init__(self, kind: ErrorKind, detail: str, *,
                 status: int | None = None, code: int | None = None) -> None:
        super().__init__(detail)
        self.kind: ErrorKind = kind
        self.detail = detail
        self.status = status
        self.code = code


class CredentialsMissing(BinanceError):
    def __init__(self, detail: str | None = None) -> None:
        super().__init__(
            "unauthorized",
            detail or ("未配置 Binance 凭据：需要 BINANCE_API_KEY，"
                       "外加 BINANCE_API_SECRET（HMAC）或 "
                       "BINANCE_PRIVATE_KEY_PATH（Ed25519/RSA）"))


# 这些 code 明确是"凭据不对/权限不够"，与网络问题分开——前端据此提示去检查 key 而不是等网络
_UNAUTHORIZED_CODES = {
    -2014,  # API-key format invalid
    -2015,  # Invalid API-key, IP, or permissions for action
    -1022,  # Signature for this request is not valid
    -1099,  # Not found, authenticated, or authorized
}
# 账户没开通该业务（没有杠杆账户/没开合约）——不是故障，是"这一项对你不适用"
_UNSUPPORTED_CODES = {
    -3003,  # margin account does not exist
    -1121,  # invalid symbol
    -4141,  # symbol offline
}
_TIMESTAMP_CODES = {-1021}  # timestamp outside recvWindow


class BinanceClient:
    """只读签名客户端。**不实现任何下单/划转/提现方法**——不是忘了，是有意的：
    这个进程持有的 key 只该有 Enable Reading，代码里也不留写入路径。
    """

    def __init__(self, api_key: str, api_secret: str = "", *,
                 private_key_path: str = "", private_key_passphrase: str = "",
                 recv_window_ms: int = 5000, timeout_s: float = 20.0,
                 signer: Signer | None = None,
                 client: httpx.Client | None = None) -> None:
        self.api_key = api_key
        # 三种 key 类型的差异全收在 signer 里；调用方只管配，代码不用分支。
        #
        # **惰性构造，且永不致命**。runtime 在模块 import 时就建这个客户端，
        # 而私钥可能不存在、可能读不了（服务以 fanisl 身份跑，用自己账号建的
        # chmod 600 文件它读不了）。第一版在 __init__ 里直接加载，于是一个配错的
        # 路径就把整个 API 进程带崩——2026-09-02 线上 502 就是这么来的。
        # 配置错误应当降级成"这个来源 unauthorized"，而不是"服务起不来"。
        self._signer = signer
        self._signer_loaded = signer is not None
        self._signer_error: str | None = None
        self._signer_config = (api_secret, private_key_path, private_key_passphrase)
        self.recv_window_ms = recv_window_ms
        # 注入 httpx.Client 是为了测试能用 MockTransport，不必联网也不必打桩私有方法
        self._http = client or httpx.Client(timeout=timeout_s)
        self._owns_http = client is None
        # 与服务器的时钟差。Binance 对 timestamp 漂移是硬拒（-1021），
        # 机器时钟慢几秒就会整片 400，而报错信息完全不像时钟问题。
        self._offset_ms: dict[str, int] = {}
        # 最近一次响应里的权重用量，给 /portfolio 之类的接口回报"这次花了多少"
        self.last_weight: dict[str, int] = {}

    @property
    def signer(self) -> Signer | None:
        if not self._signer_loaded:
            self._signer_loaded = True
            secret, key_path, passphrase = self._signer_config
            try:
                self._signer = build_signer(api_secret=secret, private_key_path=key_path,
                                            passphrase=passphrase)
            except Exception as e:  # noqa: BLE001 — 任何加载失败都只降级，不上抛
                self._signer = None
                self._signer_error = str(e)
        return self._signer

    @property
    def credential_status(self) -> str:
        """给启动横幅用：一眼看出凭据是好的、没配、还是配错了。"""
        if self.signer is not None:
            return self.signer.kind
        return f"配置有误：{self._signer_error}" if self._signer_error else "(未配置)"

    def close(self) -> None:
        if self._owns_http:
            self._http.close()

    # --- 签名 -------------------------------------------------------------

    def _sign(self, params: dict[str, Any]) -> str:
        """签好名的完整 query string。

        签名**无条件 percent-encode**：非对称签名是 base64，里面会有 `+` `/` `=`，
        直接拼进 query 的话 `+` 会被服务端解成空格、签名当场对不上。hex 编不编都一样，
        所以不分支——少一个分支，也不会出现"只在某种 key 类型下才复现"的 bug。
        """
        query = urllib.parse.urlencode(params, doseq=True)
        sig = self.signer.sign(query)
        return f"{query}&signature={urllib.parse.quote(sig, safe='')}"

    def _server_time_offset(self, base: str) -> int:
        """本地时钟 → 服务器时钟的毫秒偏移。按域名各算一份并缓存。"""
        if base in self._offset_ms:
            return self._offset_ms[base]
        path = "/fapi/v1/time" if base == FAPI_BASE else "/api/v3/time"
        try:
            resp = self._http.get(base + path)
            server_ms = int(resp.json()["serverTime"])
            self._offset_ms[base] = server_ms - int(time.time() * 1000)
        except (httpx.HTTPError, ValueError, KeyError):
            self._offset_ms[base] = 0   # 取不到就当没有偏移，让真正的请求去报错
        return self._offset_ms[base]

    # --- 请求 -------------------------------------------------------------

    def signed_get(self, base: str, path: str, params: dict[str, Any] | None = None,
                   *, _retry_on_time: bool = True) -> Any:
        if not self.api_key or self.signer is None:
            raise CredentialsMissing(self._signer_error)

        payload = {k: v for k, v in (params or {}).items() if v is not None}
        payload["timestamp"] = int(time.time() * 1000) + self._server_time_offset(base)
        payload["recvWindow"] = self.recv_window_ms
        url = f"{base}{path}?{self._sign(payload)}"

        try:
            resp = self._http.get(url, headers={"X-MBX-APIKEY": self.api_key})
        except httpx.HTTPError as e:
            raise BinanceError("unreachable", f"网络错误: {e}") from e

        self._record_weight(resp)

        if resp.status_code == 200:
            return resp.json()

        code, msg = _error_body(resp)
        # 时钟漂移：重新对时后重试一次。这是唯一值得自动重试的错误——
        # 其余的重试只会浪费权重预算。
        if code in _TIMESTAMP_CODES and _retry_on_time:
            self._offset_ms.pop(base, None)
            self._server_time_offset(base)
            return self.signed_get(base, path, params, _retry_on_time=False)

        raise _map_error(resp.status_code, code, msg, path)

    def _record_weight(self, resp: httpx.Response) -> None:
        for key, value in resp.headers.items():
            lowered = key.lower()
            if lowered.startswith(("x-mbx-used-weight-", "x-mbx-order-count-")):
                try:
                    self.last_weight[lowered] = int(value)
                except ValueError:
                    pass

    # --- 只读端点（按域名分组，路径与官方文档一字不差）----------------------

    def wallet_balance(self) -> Any:
        return self.signed_get(SPOT_BASE, "/sapi/v1/asset/wallet/balance")

    def user_asset(self) -> Any:
        # 官方文档标的是 POST（虽然语义是查询）；签名方式与 GET 相同
        return self._signed_post(SPOT_BASE, "/sapi/v3/asset/getUserAsset",
                                 {"needBtcValuation": "true"})

    def futures_account(self) -> Any:
        return self.signed_get(FAPI_BASE, "/fapi/v2/account")

    def futures_account_config(self) -> Any:
        return self.signed_get(FAPI_BASE, "/fapi/v1/accountConfig")

    def futures_position_risk(self) -> Any:
        """标记价、强平价、真实杠杆。

        **`/fapi/v2/account` 里没有这三样**——它给的是保证金与未实现盈亏，
        markPrice / liquidationPrice 只在 positionRisk 上。少了它，"距强平还有多远"
        这一列就无从算起，而那是这一页最该看的数。
        """
        return self.signed_get(FAPI_BASE, "/fapi/v2/positionRisk")

    def futures_adl_quantile(self) -> Any:
        """自动减仓排队分位（0–4）。也不在 account 里，单独一个端点。"""
        return self.signed_get(FAPI_BASE, "/fapi/v1/adlQuantile")

    def leverage_brackets(self) -> Any:
        return self.signed_get(FAPI_BASE, "/fapi/v1/leverageBracket")

    def margin_account(self) -> Any:
        return self.signed_get(SPOT_BASE, "/sapi/v1/margin/account")

    def earn_flexible_positions(self, *, size: int = 100) -> Any:
        return self.signed_get(SPOT_BASE, "/sapi/v1/simple-earn/flexible/position",
                               {"size": size})

    def earn_locked_positions(self, *, size: int = 100) -> Any:
        return self.signed_get(SPOT_BASE, "/sapi/v1/simple-earn/locked/position",
                               {"size": size})

    def futures_income(self, *, start_ms: int, end_ms: int, limit: int = 1000) -> Any:
        return self.signed_get(FAPI_BASE, "/fapi/v1/income",
                               {"startTime": start_ms, "endTime": end_ms, "limit": limit})

    def deposits(self, *, start_ms: int, end_ms: int, limit: int = 1000) -> Any:
        return self.signed_get(SPOT_BASE, "/sapi/v1/capital/deposit/hisrec",
                               {"startTime": start_ms, "endTime": end_ms, "limit": limit})

    def withdrawals(self, *, start_ms: int, end_ms: int, limit: int = 1000) -> Any:
        return self.signed_get(SPOT_BASE, "/sapi/v1/capital/withdraw/history",
                               {"startTime": start_ms, "endTime": end_ms, "limit": limit})

    def account_snapshot(self, kind: str = "SPOT", *, limit: int = 30) -> Any:
        return self.signed_get(SPOT_BASE, "/sapi/v1/accountSnapshot",
                               {"type": kind, "limit": limit})

    def spot_open_orders(self) -> Any:
        return self.signed_get(SPOT_BASE, "/api/v3/openOrders")

    def spot_open_order_lists(self) -> Any:
        return self.signed_get(SPOT_BASE, "/api/v3/openOrderList")

    def futures_open_orders(self) -> Any:
        return self.signed_get(FAPI_BASE, "/fapi/v1/openOrders")

    def margin_open_orders(self) -> Any:
        return self.signed_get(SPOT_BASE, "/sapi/v1/margin/openOrders")

    def algo_open_orders(self) -> Any:
        """策略单（TWAP/VP）。多数账户是空的，但空与"没查"是两回事——
        不查就等于悄悄漏掉一类挂单。
        """
        return self.signed_get(SPOT_BASE, "/sapi/v1/algo/futures/openOrders")

    def spot_all_orders(self, symbol: str, *, start_ms: int, end_ms: int,
                        limit: int = 500) -> Any:
        return self.signed_get(SPOT_BASE, "/api/v3/allOrders",
                               {"symbol": symbol, "startTime": start_ms,
                                "endTime": end_ms, "limit": limit})

    def futures_all_orders(self, symbol: str, *, start_ms: int, end_ms: int,
                           limit: int = 500) -> Any:
        return self.signed_get(FAPI_BASE, "/fapi/v1/allOrders",
                               {"symbol": symbol, "startTime": start_ms,
                                "endTime": end_ms, "limit": limit})

    def spot_my_trades(self, symbol: str, *, start_ms: int, end_ms: int,
                       limit: int = 500) -> Any:
        return self.signed_get(SPOT_BASE, "/api/v3/myTrades",
                               {"symbol": symbol, "startTime": start_ms,
                                "endTime": end_ms, "limit": limit})

    def spot_trades_since(self, symbol: str, *, from_id: int = 0,
                          limit: int = 1000, max_pages: int = 20) -> list[dict]:
        """一个交易对的成交，从 `from_id` 起往后取全。

        用 `fromId` 而不是时间窗：`startTime`/`endTime` 同时给的时候窗口最多 24 小时，
        要回溯全历史就得翻上千次；`fromId` 没有时间上限，一次 1000 条往前走。
        成本基础必须看**全部**成交，少一笔均价就错。

        `max_pages` 是护栏：单次调用权重 20，20 页就是 400，够 2 万笔成交。
        真的超了会在返回里少数据——调用方拿最后一个 tradeId 下次接着走。
        """
        out: list[dict] = []
        cursor = from_id
        for _ in range(max_pages):
            page = self.signed_get(SPOT_BASE, "/api/v3/myTrades",
                                   {"symbol": symbol, "fromId": cursor, "limit": limit})
            if not isinstance(page, list) or not page:
                break
            out.extend(page)
            if len(page) < limit:
                break
            # fromId 是"**大于等于**"，不加一会把最后一条重复取一遍，永远走不完
            cursor = max(int(t.get("id", 0)) for t in page) + 1
        return out

    def orders_since(self, symbol: str, *, venue: str, from_id: int = 0,
                     limit: int = 1000, max_pages: int = 10) -> list[dict]:
        """一个交易对的委托历史，从 `from_id` 起往后取全。

        不能用时间窗：`allOrders` 的 startTime/endTime 间隔最多 24 小时（现货）
        / 7 天（合约），只取最近一个窗口的话，**上次交易在窗口之前就是一片空白**
        ——这正是"历史那里完全没有数据"的原因。`orderId` 翻页没有时间上限，
        合约那边受接口本身只留 90 天所限。
        """
        base = FAPI_BASE if venue == "usdm" else SPOT_BASE
        path = "/fapi/v1/allOrders" if venue == "usdm" else "/api/v3/allOrders"
        out: list[dict] = []
        cursor = from_id
        for _ in range(max_pages):
            page = self.signed_get(base, path,
                                   {"symbol": symbol, "orderId": cursor, "limit": limit})
            if not isinstance(page, list) or not page:
                break
            out.extend(page)
            if len(page) < limit:
                break
            # orderId 是"**大于等于**"，不加一会把最后一条重复取一遍
            cursor = max(int(o.get("orderId", 0)) for o in page) + 1
        return out

    def futures_trades_since(self, symbol: str, *, from_id: int = 0,
                             limit: int = 1000, max_pages: int = 10) -> list[dict]:
        """合约成交，`fromId` 翻页。接口只保留 90 天，走到头自然停。"""
        out: list[dict] = []
        cursor = from_id
        for _ in range(max_pages):
            page = self.signed_get(FAPI_BASE, "/fapi/v1/userTrades",
                                   {"symbol": symbol, "fromId": cursor, "limit": limit})
            if not isinstance(page, list) or not page:
                break
            out.extend(page)
            if len(page) < limit:
                break
            cursor = max(int(t.get("id", 0)) for t in page) + 1
        return out

    def futures_user_trades(self, symbol: str, *, start_ms: int, end_ms: int,
                            limit: int = 500) -> Any:
        return self.signed_get(FAPI_BASE, "/fapi/v1/userTrades",
                               {"symbol": symbol, "startTime": start_ms,
                                "endTime": end_ms, "limit": limit})

    def universal_transfers(self, kind: str, *, start_ms: int, end_ms: int,
                            size: int = 100) -> Any:
        # type 是必填的：要看全部划转得按类型逐个问（约 40 种，见 ledger.py 的取舍）
        return self.signed_get(SPOT_BASE, "/sapi/v1/asset/transfer",
                               {"type": kind, "startTime": start_ms, "endTime": end_ms,
                                "size": size})

    def earn_flexible_rewards(self, *, start_ms: int, end_ms: int,
                              kind: str = "REWARDS", size: int = 100) -> Any:
        return self.signed_get(SPOT_BASE, "/sapi/v1/simple-earn/flexible/history/rewardsRecord",
                               {"type": kind, "startTime": start_ms, "endTime": end_ms,
                                "size": size})

    def earn_locked_rewards(self, *, start_ms: int, end_ms: int, size: int = 100) -> Any:
        return self.signed_get(SPOT_BASE, "/sapi/v1/simple-earn/locked/history/rewardsRecord",
                               {"startTime": start_ms, "endTime": end_ms, "size": size})

    def margin_interest_history(self, *, start_ms: int, end_ms: int, size: int = 100) -> Any:
        return self.signed_get(SPOT_BASE, "/sapi/v1/margin/interestHistory",
                               {"startTime": start_ms, "endTime": end_ms, "size": size})

    def convert_trade_flow(self, *, start_ms: int, end_ms: int, limit: int = 100) -> Any:
        return self.signed_get(SPOT_BASE, "/sapi/v1/convert/tradeFlow",
                               {"startTime": start_ms, "endTime": end_ms, "limit": limit})

    def dust_log(self, *, start_ms: int, end_ms: int) -> Any:
        return self.signed_get(SPOT_BASE, "/sapi/v1/asset/dribblet",
                               {"startTime": start_ms, "endTime": end_ms})

    def klines(self, symbol: str, interval: str = "1d", limit: int = 31) -> Any:
        """日线收盘。公开端点、不签名、权重 2。

        日快照给的是 **BTC 计价**的资产总额，要换成 USD 就得用**当天**的 BTC 价，
        不能拿今天的价去乘 30 天前的余额——那样画出来的是 BTC 的走势，不是账户的。
        """
        try:
            resp = self._http.get(SPOT_BASE + "/api/v3/klines",
                                  params={"symbol": symbol, "interval": interval,
                                          "limit": limit})
        except httpx.HTTPError as e:
            raise BinanceError("unreachable", f"网络错误: {e}") from e
        self._record_weight(resp)
        if resp.status_code != 200:
            code, msg = _error_body(resp)
            raise _map_error(resp.status_code, code, msg, "/api/v3/klines")
        return resp.json()

    def spot_prices(self) -> Any:
        """全市场最新价，公开端点、不签名。现货估值与合约标记价都要它。"""
        try:
            resp = self._http.get(SPOT_BASE + "/api/v3/ticker/price")
        except httpx.HTTPError as e:
            raise BinanceError("unreachable", f"网络错误: {e}") from e
        self._record_weight(resp)
        if resp.status_code != 200:
            code, msg = _error_body(resp)
            raise _map_error(resp.status_code, code, msg, "/api/v3/ticker/price")
        return resp.json()

    # --- 内部 -------------------------------------------------------------

    def _signed_post(self, base: str, path: str, params: dict[str, Any] | None = None) -> Any:
        if not self.api_key or self.signer is None:
            raise CredentialsMissing(self._signer_error)
        payload = {k: v for k, v in (params or {}).items() if v is not None}
        payload["timestamp"] = int(time.time() * 1000) + self._server_time_offset(base)
        payload["recvWindow"] = self.recv_window_ms
        try:
            resp = self._http.post(f"{base}{path}?{self._sign(payload)}",
                                   headers={"X-MBX-APIKEY": self.api_key})
        except httpx.HTTPError as e:
            raise BinanceError("unreachable", f"网络错误: {e}") from e
        self._record_weight(resp)
        if resp.status_code == 200:
            return resp.json()
        code, msg = _error_body(resp)
        raise _map_error(resp.status_code, code, msg, path)


def _error_body(resp: httpx.Response) -> tuple[int | None, str]:
    try:
        body = resp.json()
    except ValueError:
        return None, (resp.text or "")[:200]
    if isinstance(body, dict):
        return body.get("code"), str(body.get("msg", ""))[:200]
    return None, str(body)[:200]


def _map_error(status: int, code: int | None, msg: str, path: str) -> BinanceError:
    """HTTP 状态 + Binance 错误码 → 前端要显示的那五种状态之一。

    分类是给人看的：`unauthorized` 说明去检查 key 的权限与 IP 白名单，
    `unreachable` 说明等网络或换出口，两者的处置完全不同，不该混成一句"失败"。
    """
    if code in _UNAUTHORIZED_CODES or status == 401:
        return BinanceError("unauthorized",
                            f"凭据或权限不足（{code}）：{msg or '检查 key 权限与 IP 白名单'}",
                            status=status, code=code)
    if status in (418, 429):
        return BinanceError("rate_limited",
                            f"被限流（HTTP {status}）：{msg or '权重超限，稍后再试'}",
                            status=status, code=code)
    if status == 451:
        return BinanceError("unreachable",
                            f"HTTP 451 — {path.split('/')[1]} 拒绝当前出口地区",
                            status=status, code=code)
    if code in _UNSUPPORTED_CODES:
        return BinanceError("unsupported", f"该账户未开通此项（{code}）：{msg}",
                            status=status, code=code)
    if status >= 500 or status == 403:
        return BinanceError("unreachable", f"上游异常 HTTP {status}：{msg}",
                            status=status, code=code)
    return BinanceError("unsupported", f"HTTP {status} code={code}：{msg}",
                        status=status, code=code)
