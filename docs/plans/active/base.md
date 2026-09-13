# base — active

共用底座与运维（`backend/fanisl/` 包根、`collect/` `chat/` `data/` `auth/` `tools/`、
`backend/api.md`、`shared/**`、`deploy/**`）。

## Now
（待该席位填）

## Next
- **服务器上 `binance-ed25519.pem` 权限**：API 启动时 `Permission denied`，
  修法：`sudo chown fanisl:fanisl /opt/fanisl/backend/binance-ed25519.pem && sudo chmod 600 ...`
- **文档数字断言**：把 `90 符号`、`77 条 overrides` 这类数写进测试。
  设计文档曾长期写着 39 与 103，没有任何机制会发现
- `docs/data/` 六份停在 2026-07-13，与现状（90 符号、eps_estimates、daily_bars）
  可能已经脱节，引用前先核

## Blocked on
- 无

## Requests in
- **console 席位**：见上面 pem 权限那条
- **knowledge 席位（2026-09-13）**：单元核查功能的接口与鉴权，见 `features/unit-review.md` 第 4 节。
  先改 `backend/api.md`（新增 §5.6）再写代码；这是知识域第一个写接口，写操作要求 admin，
  `author` 取自会话、不信请求体，不开答复接口
