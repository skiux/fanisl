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
- **console 席位（2026-10-03 第二条，告知）**：账户历史（`binance/history_job.py`）挂到了采集进程，`worker_collector.py`
  加了第三条调度车道 `account`（任务 `binance_history`，600 s）——收盘要在 UTC 零点后尽快做，不能排在知识库日报
  后面。没配 Binance 凭据时任务直接返回。它往主库写三张新表 `account_snapshots` / `daily_pnl` / `binance_records`，
  `backup.sh` 整库 dump，已覆盖。`api.md` 的 `/portfolio` 一节补了 `pnl.daily[].frozen`、`nav_close_usd`，并改了「成员只能
  看 90 天」那段（存定的日子接在前面之后，`_clip_for_member` 真的在裁了）；`main.py` 里 `_clip_for_member` 的 docstring
  同样改了，代码没动。请过目
- **console 席位（2026-10-03，告知）**：新增 `GET /portfolio/fund`、`PUT /admin/fund`、`PUT /admin/fund/members/{user_id}`
  （`binance/routes.py`，挂在已有前缀下，nginx 不用改）。`api.md` 已由 console 席位直接补了 §1.8 一节并把头部总数改成
  86——不补的话 `tests/test_api_doc.py` 对所有席位都是红的。请过目，措辞按你的习惯改即可。
  新表 `fund_members` 外键指向 `users(id) ON DELETE CASCADE`：删用户会连带删掉他的分配规则
- **knowledge 席位（2026-10-01，用户要求备份时发现）**：
  ① `deploy/pull-snapshot.sh` 第 3 步一次 tar 传全部关键帧，两次都在约 640MB 处被远端断开（"Connection closed by
  remote host"），本机只到 4745/5520 张；改成按缺失清单分批传（本机 `~/gcp-backups/backup-server.sh` 第 3 步的做法）。
  ② 备份用的 `fanisl-backup.service/.timer` 只在服务器上，仓库里没有（Next 第 1 条），10-01 已随整机备份拉到本机
  `~/gcp-backups/<时间戳>/system/etc/systemd/system/`，可以从那里入库
  ③ 用户 10-02 定：备份统一放 `~/gcp-backups`。`pull-snapshot.sh` 默认仍写 `~/fanisl-backups` 与 `~/fanisl-keyframes`
  （这两个目录已按用户要求移到废纸篓），请改默认目录，或注明已由 `~/gcp-backups/backup-server.sh` 取代
- **console 席位（2026-10-01）**：`GET /binance/portfolio` 的 `pnl.daily[]` 新增
  `settled_parts`，与 `today.settled_parts` 同结构，逐日拆出 `realized_pnl`、
  `funding_fee`、`commission`、`insurance_clear`、`referral_kickback`、`other`；
  `income` 来源不可用时为 null。`settled_usd` 仍是这些分项的合计。请更新 `backend/api.md` 契约。
- **knowledge 席位（2026-09-29）**：提帧已恢复（yt-dlp 开了 JS 运行时，见 `knowledge/keyframes.py` 顶注）。
  ① `tools/check_sources.py` 的「提帧取直链」请从「已知会失败的」移回主线计入结论；
  ② `main.py` 里 `/knowledge/contents/{id}/keyframes` 的 docstring 说帧只在图表/表格与带数值的笔记时刻才有，
  现在每期视频是整片按画面变化留帧（`kind='scene'`），09-28 以前的旧帧仍是按笔记取的
- **knowledge 席位（2026-09-24）**：内容状态新增 `reference`（只入库供阅读、不做提取，@MeiTouNews 的内容）。
  `tools/check_ingest.py` 把 extracted 以外的状态都标「（待提取）」，`reference` 请单列为「仅阅读」
- **knowledge 席位（2026-09-24，不急）**：`contents` 加了 `handle` 列（摄取自哪个频道；美投君现有 @MeiTouJun 与
  @MeiTouNews 两个频道）。`GET /knowledge/contents/{id}` 是 `SELECT c.*`，响应因此多一个 `handle` 字段，
  老内容里多频道信源的那几条可能为 null；列表行不含。`api.md` 那一节写的是「同上 + raw」，请补一句
- **console 席位**：pem 权限，见 Next 第 1 条
- **knowledge 席位（2026-09-25）**：`/knowledge/relations` 的两侧计数已实现（frontend 09-13 的请求）。每条边新增
  `a_hit a_partial a_miss a_n_creators a_n_contents`，b 侧同名，口径同 `/knowledge/nodes` 的行；原有字段不变。请更新 `api.md` §5.3
