# base — active

共用底座与运维（`backend/fanisl/` 包根、`collect/` `chat/` `data/` `auth/` `tools/`、
`backend/api.md`、`shared/**`、`deploy/**`）。

## Now
- 2026-09-24 这批已完成，已提交（ec99e66）：`api.md` 补齐 console 与 knowledge 的契约请求、nginx gzip（仓库侧）、
  `write_changed` 限定回看窗口、几份文档的事实更正

## Next
1. **要登服务器做的事**（本席位没有服务器权限，也不该不打招呼动线上）。2026-09-25 knowledge 席位按用户要求登服务器核对：
   - ~~生效 nginx 配置补 gzip~~：生效配置 09-24 05:08 UTC 已补（备份 `/etc/nginx/fanisl.conf.bak-gzip`），线上 JS 实测带
     `Content-Encoding: gzip`。`sites-enabled/` 里确有 `fanisl.bak` 与 `fanisl.bak.2026-09-01` 两份（内容相同），`nginx -t`
     因此报 4 条 conflicting server name；已挪到 `/etc/nginx/fanisl.conf.bak-routes-0901`、`fanisl.conf.bak-2026-09-01`，
     `nginx -t` 干净后 reload，首页与 /console/ 均 200
   - ~~`binance-ed25519.pem` 权限~~：已是 `fanisl:fanisl 600`，API 近 7 天日志没有 `Permission denied`
   - 备份的 systemd 单元不在仓库里（只写在 `deploy/README.md` §8 的 heredoc）：取回线上那份再入库，否则一入库就报漂移（未做）
2. **`main.py` 按产品拆 router**：console 已经这样做了（`binance/routes.py`，main 只 `include_router`）。
   knowledge（36 条）与 trading（16 条）仍写在 main 里；拆的话由各自席位在自己目录建 routes 模块、base 改装配，
   先约好时间窗口
3. **`/watchlist` 很慢且没人调用**：逐标的查最新值不带时间下界，服务器上每个标的约 3 s（2026-09-24 实测，
   规划期要展开全部 3951 个 chunk）。要么删掉，要么传时间下界（全局宏观是月频，窗口太短会漏掉它们）
4. auto-update 与 sudoers 只重启 api、collector。trader 哪天启用，后端更新不会重启它
5. `docs/data/` 六份停在 2026-07-13，与现状可能已经脱节，引用前先核

## Blocked on
- **等用户定：成员的写权限（资产台与对话）。** 中间件只判断登录与否：member 能调会花 Claude 额度的 `/chat`、
  `/trading/open|scan|detect`，能改强制交易开关、手动开平仓、撤单；`conversations` 表没有归属列，所有人的对话
  互相可见、可改名、可删除。知识站按根 `AGENTS.md` §1 不分角色，不在这条里
- **等用户定：席位表没覆盖的代码与文件。** `backend/fanisl/indicators/` `snapshot/` `research/`、`backend/tests/`、
  `backend/pyproject.toml`、`backend/AGENTS.md` 没有归属；席位表里的 `tools/` 分不清是 `backend/tools/` 还是
  `backend/fanisl/tools/`。`backend/.env.example` 停在 SQLite 时代（有 `DB_PATH`，没有 PG / AUTH / BINANCE），
  `backend/README.md` 指的是 `deploy/.env.example`，建议删掉——删文件不算事实更正，没动

## Requests in
- **knowledge 席位（2026-09-24）**：内容状态新增 `reference`（只入库供阅读、不做提取，@MeiTouNews 的内容）。
  `tools/check_ingest.py` 把 extracted 以外的状态都标「（待提取）」，`reference` 请单列为「仅阅读」
- **knowledge 席位（2026-09-24，不急）**：`contents` 加了 `handle` 列（摄取自哪个频道；美投君现有 @MeiTouJun 与
  @MeiTouNews 两个频道）。`GET /knowledge/contents/{id}` 是 `SELECT c.*`，响应因此多一个 `handle` 字段，
  老内容里多频道信源的那几条可能为 null；列表行不含。`api.md` 那一节写的是「同上 + raw」，请补一句
- **console 席位**：pem 权限，见 Next 第 1 条
- **knowledge 席位（2026-09-25）**：`/knowledge/relations` 的两侧计数已实现（frontend 09-13 的请求）。每条边新增
  `a_hit a_partial a_miss a_n_creators a_n_contents`，b 侧同名，口径同 `/knowledge/nodes` 的行；原有字段不变。请更新 `api.md` §5.3
