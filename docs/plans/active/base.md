# base — active

共用底座与运维（`backend/fanisl/` 包根、`collect/` `chat/` `data/` `auth/` `tools/`、
`backend/api.md`、`shared/**`、`deploy/**`）。

## Now
- **单元核查接口**（`features/unit-review.md` 第 4 节）：`api.md` §5.6、五个接口、鉴权与测试
  已完成，**已提交（2026-09-14）、未推送**。推送即上线（auto-update 5 分钟内拉取），frontend 要等上线后才能
  对真接口联调。同一批里还有 auto-update、调度器、库守卫、websocket 鉴权、回填几处修复

## Next
1. **`main.py` 按产品拆 router**：70 条路由里 knowledge 36（含 `/asset` `/research`）、
   trading 16、binance 3，base 自己 15；8 月以来 21 次提交来自各条线。仿 `auth/routes.py`
   拆成各自的 `APIRouter` 模块、main 只做装配，文件归属就与席位对齐。会碰到另外两个席位
   正在改的代码，先约好时间窗口
2. **`write_changed` 与 `/watchlist` 的查询代价没测过**：两者都对 `GLOBAL` 做跨全部 chunk 的
   `DISTINCT ON`（08-18 时 3945 个 chunk）。先在服务器上测，再决定改不改：
   `EXPLAIN (ANALYZE, BUFFERS) SELECT DISTINCT ON (metric) metric, ts, value FROM metric_samples WHERE symbol = 'GLOBAL' ORDER BY metric, ts DESC;`
3. **服务器上 `binance-ed25519.pem` 权限**：API 启动时 `Permission denied`。要 SSH 上去执行
   `sudo chown fanisl:fanisl /opt/fanisl/backend/binance-ed25519.pem && sudo chmod 600 …`
4. **备份的 systemd 单元不在仓库里**：只写在 `deploy/README.md` §8 的 heredoc 里，漂移检测
   管不到。先从服务器取回线上那份再入库，否则一入库就报漂移
5. auto-update 与 sudoers 只重启 api、collector。trader 哪天启用，后端更新不会重启它
6. `docs/data/` 六份停在 2026-07-13，与现状（90 符号、eps_estimates、daily_bars）
   可能已经脱节，引用前先核

## Blocked on
- **等用户定：成员的写权限。** 中间件只判断登录与否：member 能调会花 Claude 额度的 `/chat`、
  `/trading/open|scan|detect`，能改强制交易开关、手动开平仓、撤单；`conversations` 表没有
  归属列，所有人的对话互相可见、可改名、可删除。单元核查的写接口 2026-09-17 起只要求登录（用户定：角色只属于 console），不在这条的讨论范围内
- **等用户定：席位表没覆盖的文件。** 下面这些已知过期，因为无主，本席位没改：
  - `backend/README.md`：结构图仍把 `agent.py` `storage.py` `flatten.py` `collector.py` 列在包根；
    写"当前加密=OKX"，实为 Binance
  - `docs/ARCHITECTURE.md`：同样漏了 `collect/` `chat/` 前缀；存储一节写"两个库"；标的数写 97，
    `len(assets.all_assets())` 实测 102
  - `docs/README.md`：写"60 端点"，实为 81（`api.md` 里的数已由 `tests/test_api_doc.py` 核对）
  - 根 `AGENTS.md`："534 passed"，测试一加就漂（本批之后已不是这个数），建议改成"全部通过"
  - `backend/.env.example`：停在 SQLite 时代（有 `DB_PATH`，没有 PG / AUTH / BINANCE），
    而 `backend/README.md` 指的是 `deploy/.env.example`，建议删掉
  - 同样无主：`backend/fanisl/indicators/` `snapshot/` `research/`、`backend/tests/`、
    `backend/pyproject.toml`、`backend/AGENTS.md`，以及 `docs/` 顶层、`docs/data/`、
    `docs/decisions/`。席位表里的 `tools/` 分不清是 `backend/tools/` 还是 `backend/fanisl/tools/`

## Requests in
- **console 席位（2026-09-22）**：请在 `backend/api.md` 补录
  `GET /portfolio` 的 `spot_costs: Record<asset, {asset, trade_value_usd,
  commission_usd, position_qty, updated_at}>`。该记录只用于当前跨钱包币仓的成本展示，
  不进入 `pnl` 汇总。另补管理员 `PUT /admin/spot-costs/{asset}`：请求体含
  `trade_value_usd > 0`、`commission_usd >= 0`、`position_qty > 0`，只写本地表；
  稳定币拒绝录入。数量不符或余额源不可用时由 console 停用旧成本。
  当前路由表为 83 条，`api.md` 头部仍写 81；`tests/test_api_doc.py` 还同时报告缺少
  本路径及上一条请求的 `/admin/stock-costs/{symbol}`，请一并补齐契约。
- **console 席位（2026-09-21，替代 09-20 的旧请求）**：`backend/api.md` 的
  `GET /portfolio` 返回字段请补 `yield_rates: Record<string, number | null>`；当前首个键为
  `BFUSD`，取自 `/sapi/v1/bfusd/history/rateHistory` 最近一条
  `annualPercentageRate`。同时补齐 `stocks`、`capabilities`、`isolated_margin`、
  `liquidation_loan`、`portfolio_margin` 与 `stable_assets`。股票成本已改为管理员录入：
  `stocks.positions[].cost_status` 为 `manual | missing | stale`，并返回
  `trade_value_usd`、`commission_usd`、`cost_position_qty`、`cost_updated_at`；
  `cost_coverage` 为 `{manual, stale, total}`。另请记录管理员接口
  `PUT /admin/stock-costs/{symbol}`，请求体为上述前两项加 `position_qty`，只写本地表。
- **console 席位**：pem 权限，见 Next 第 3 条
- **console 席位（2026-09-17）**：`backend/api.md` 的 `GET /orders` 一节已与实现不符，请改：
  ① Query 的 `venue` 还有 `equity`；② `history_symbols` 的候选来源现在是「挂单 + 持仓 +
  近 90 天合约收支 + 股票委托与成交 + 现货余额」；③ 新字段 `history_venues`
  （`{symbol: spot|usdm|margin|equity}`，前端按它给下拉框分组）；④「全部」时合约也逐个
  交易对问，不用省略 symbol 的全账户 allOrders，理由见 `backend/fanisl/binance/README.md`
  「委托页的硬边界」
- **knowledge 席位（2026-09-13）**：单元核查接口，见 Now
- **frontend 席位（2026-09-13，不急）**：`GET /knowledge/relations` 的每条边请带上两侧节点的
  `hit / partial / miss / n_creators / n_contents`（`/knowledge/nodes` 的行里已有这几个字段）。
  发现页简报为挑"重点发现"，现在要逐条取两侧节点详情：9 条对立边 = 18 次请求，本机经隧道实测
  最后一个 6.8s 才返回（`/relations` 本身 0.39s）；生产上往返短得多，没测（线上要登录）。
  字段加上后前端改为只用关系边一次请求。"同源/跨源"用 note 前缀就能判，不需要另加字段
- **已处理（2026-09-17，用户让 knowledge 席位直接改）** knowledge 席位：单元核查三个写接口去掉管理员限制，改为只要求登录。
  用户定的原则：角色只属于 console，知识站不分角色（根 `AGENTS.md` §1）。要改：
  `main.py` 三处 `Depends(auth_routes.require_admin)` → `Depends(auth_routes.current_user)`；
  `api.md` §0 常见错误里「403 需要管理员（§5.6 的写接口）」、§5.6 那段 admin 说明、
  🔑 图例对核查接口的标注、附录 A「member 账号一律 403」那行；
  `tests/test_unit_review_api.py::test_member_can_read_but_not_write` 改为 member 可写。
  依据与验收见 `features/unit-review.md` 第 1 节第 6 条、第 6 节 3b
