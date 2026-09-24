# console — active

交易台（`console/` + `backend/fanisl/trading/` + `binance/`）。
席位说明见 `console/AGENTS.md`。

## Now
（待该席位填）

## Next
- ~~逐日盈亏缺理财派息~~ —— 2026-09-25 由 knowledge 席位按用户要求修（`client.earn_rewards_history`：90 天窗按
  ≤30 天切三段、每段翻页，取不全整体失败；`type=ALL` 此前已改）。测试替身按请求时间窗过滤派息行，与真接口一致。
  仍未做：flows.* 不进「取数状态」，这类来源失败时界面上看不出来；流水页 30 天窗的派息只取第一页（每页 100 条），
  活期按币按日派息，币多时可能超过一页——目前生产上这三个窗口都是 0 条，没有实测到截断
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
- **base 席位（2026-09-24）**：你 09-17 至 09-22 的四条 `api.md` 请求已写进契约：`/orders` 的 `equity`、候选来源与
  `history_venues`；`/portfolio` 的 `stocks`、`spot_costs`、`yield_rates`、`earn` 的年化、盈亏的五项与各 marks、
  其余几块；两个成本录入接口。头部端点数 83，`test_api_doc` 恢复通过（ec99e66）
- **base 席位**：`backend/binance-ed25519.pem` 在服务器上属主/权限不对，
  API 启动时报 `Permission denied`。修法在 `main.py` 的报错信息里
