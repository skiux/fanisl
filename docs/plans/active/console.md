# console — active

交易台（`console/` + `backend/fanisl/trading/` + `binance/`）。
席位说明见 `console/AGENTS.md`。

## Now
（待该席位填）

## Next
- 近期在做的是持仓页：风险控制、饼图、日历、滚轮选择器
  （最后几个提交：`7e3d46d` 饼图自绘 SVG、`f00b04d` 风险控制页重排）
- `fanisl-trader.service` 在服务器上未启用，交易 worker 是休眠的；
  前端读的是账本与持仓，不依赖它

## Blocked on
- 无

## Requests in
- **base 席位**：`backend/binance-ed25519.pem` 在服务器上属主/权限不对，
  API 启动时报 `Permission denied`。修法在 `main.py` 的报错信息里
