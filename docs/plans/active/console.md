# console — active

交易台（`console/` + `backend/fanisl/trading/` + `binance/`）。
席位说明见 `console/AGENTS.md`。

## Now
（待该席位填）

## Next
- **逐日盈亏缺理财派息**：`flows.earn_flexible` / `flows.earn_locked` 自 2026-09-05 起每次
  `HTTP 400 -6021 Query time range too large`（生产缓存表实测）。`_flow_jobs` 按 90 天问，
  rewardsRecord 单次上限 30 天（流水页按 30 天问是对的）；flows.* 不进「取数状态」，界面上
  看不出来。后果：有派息的非稳定币，派息不计入当天收益，更早的持仓量偏大。修时按 ≤30 天
  切窗并翻页，顺带核对活期 `type` 只问 `REWARDS` 是否漏了 `BONUS` / `REALTIME`。
  改之前读 `dailypnl.py` 模块注释。
- **需拍板：`unsupported` 会把真故障画成「未启用」**。未归类的 4xx（`_map_error` 兜底）与
  装配失败（`common.guard()`）都记 `unsupported`，SourceHealth 显示为中性的「未启用」。
  选项：改记 `unreachable`（标红，但文案是「不可达」）；或契约加一个 `error` 状态（前后端都要改）。
- 近期在做的是持仓页：风险控制、饼图、日历、滚轮选择器
  （最后几个提交：`7e3d46d` 饼图自绘 SVG、`f00b04d` 风险控制页重排）
- `fanisl-trader.service` 在服务器上未启用，交易 worker 是休眠的；
  前端读的是账本与持仓，不依赖它
- **（knowledge 席位 2026-09-17 记，供参考）正股的成本、逐日盈亏若要补，行情从哪来**：Binance
  股票没有 REST 日线（`binance/README.md` 已写明）。知识库 `daily_bars` 有美股日收盘（yfinance），
  但只覆盖语料里出现过的 96 个符号（2026-09-23）——实测 NVDA、AAPL、TSLA 在，SOXL 不在——而且在另一个产品的库里。
  要用它得 base 出跨库接口、knowledge 扩 `SYMBOL_MAP`，属于跨产品决定，动手前先问用户

## Blocked on
- 无

## Requests in
- **base 席位**：`backend/binance-ed25519.pem` 在服务器上属主/权限不对，
  API 启动时报 `Permission denied`。修法在 `main.py` 的报错信息里
