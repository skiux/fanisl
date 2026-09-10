# 日常运营与维护

> 写给维护者本人的操作手册，不是给 agent 的。agent 看 `../AGENTS.md`。
> 里面的数字与状态核对于 2026-09-10，命令都实跑过。

## 一分钟体检

```bash
curl -s https://fanisl.skiuo.com/health          # 期望 {"status":"ok"}
curl -so /dev/null -w "%{http_code}\n" https://fanisl.skiuo.com/
curl -so /dev/null -w "%{http_code}\n" https://fanisl.skiuo.com/console/
```

三个都正常就没大事。有异常再往下：

```bash
ssh enin@35.240.252.205
systemctl is-active fanisl-api fanisl-collector nginx     # 三个 active
systemctl list-timers 'fanisl*' --no-pager                # update 每 5 分钟、backup 每天
systemctl status fanisl-update --no-pager | head -5        # failed 说明有事要人工处理
```

**`fanisl-update` 停在 failed 是设计如此的信号**，不是噪音——它现在只在需要人工介入时
才失败（最常见的是 systemd 单元漂移，见下）。看到就处理，处理完它自己会恢复。

## 系统长什么样

| | 位置 | 备注 |
|---|---|---|
| 服务器 | GCE 新加坡，`enin@35.240.252.205` | 唯一入口是 `~/.ssh/google_compute_engine`（带口令） |
| 代码 | `/opt/fanisl`，以 `fanisl` 身份运行 | 每 5 分钟自动拉 `origin/main` |
| Postgres | docker 容器 `fanisl-pg`（timescaledb pg17） | 只监听 127.0.0.1，防火墙只放 80/443 |
| 库 | `fanisl` 603MB · `fanisl_knowledge` 32MB · `fanisl_trading` 12MB | **服务器库是唯一真库**，本机那三个是空 dev 库 |
| 磁盘 | 79G，已用 14G（19%） | 关键帧只有 32K，不是增长点 |
| 备份 | `/opt/fanisl/backups/`，每天 04:31 UTC，三库各留 14 份 | 现有 42 个 dump |

**三个服务**：`fanisl-api`（uvicorn，:8000）· `fanisl-collector`（采集与知识引擎日/周维护）
· `fanisl-trader`（**未启用**，交易 worker 休眠中）。

## 内容进来了吗、提取了吗

```bash
cd backend && PYTHONPATH=. .venv/bin/python tools/check_ingest.py
```

在服务器上跑看的是全貌；在本机跑，**前两节（采集调度、行情时间序列）会显示为空**——
那两节读的是本机的空 dev 库，不是服务器采集停了。脚本自己会提示这一点。

摄取由 collector 的日班次自动跑，间隔 24 小时，所以**一期新内容最长可能等约一天**。
等不及就手动拉（幂等，已入库的跳过，不会重复付 Gemini）：

```bash
cd backend && source .venv/bin/activate
python -m fanisl.knowledge.backfill_transcripts @yttalkjun --since-days 4
```

`失败：HTTP 403` 一般是**会员专属视频**，Gemini 读不了，不是故障；新公开内容入库后
窗口收窄，它会自然滑出。

本机要读知识库得先起隧道：

```bash
ssh-add ~/.ssh/google_compute_engine
ssh -i ~/.ssh/google_compute_engine -N -L 5433:127.0.0.1:5432 enin@35.240.252.205 \
    -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes &
```

隧道断的表现是 `PoolTimeout`，跑一半的批处理会中断——提取产出的 JSON 已经落盘，
恢复隧道后重跑 `import_units` 即可，它按 `(content_id, extractor_version)` 唯一。

## 更新与部署

推到 `origin/main` 之后，服务器 5 分钟内自动拉取：装依赖 → 验 import → 重启 → 查健康，
任一步失败自动回滚。**多数时候你什么都不用做。**

两种要人工介入的情况：

**① 改了 `deploy/*.service`。** `/etc/systemd/system` 里那份是**复制品不是软链**，
`git pull` 动不了它。auto-update 会检测到并把命令打出来：

```bash
sudo install -m 644 /opt/fanisl/deploy/fanisl-api.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl restart fanisl-api fanisl-collector
```

只跑 `daemon-reload` 没有用，必须先 `install`。

**② 改了 nginx。** 线上那份被 certbot 改过（含 443 与证书配置），**与仓库里的不一致**，
不要整份覆盖。只改需要改的那几行，然后：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

手动更新一轮：`sudo -u fanisl /opt/fanisl/deploy/auto-update.sh`

## 出问题时（按症状）

**站点 502 / 打不开** → `systemctl is-active fanisl-api`。若是 `activating`，说明在重启
死循环，看 `journalctl -u fanisl-api -n 30`。历史上两次都是 systemd 单元过期
（ExecStart 指向已改名的模块）。

**服务 active 但页面数据不对** → 多半是前端构建产物旧了。
`ls -l /opt/fanisl/frontend/dist/index.html` 看时间；auto-update 只在对应目录变了才重建。

**频道有更新但库里没有** → 先确认不是那 24 小时窗口。再确认不是会员视频（403）。
都不是就手动跑 `backfill_transcripts` 看报错。

**本地前端拿不到数据** → 检查 `backend/.env` 里三个 conninfo 是否齐全。
`runtime` 在模块级就开三个池，**少配一个，受影响的可能是看起来毫不相干的页面**。

**`fanisl-update` 一直 failed** → `journalctl -u fanisl-update -n 20`。
它现在只在真需要人工时才失败，日志里会写清楚该跑什么。

**导入提取结果被拒** → `quote 校验失败，整文件拒绝` 是设计如此：quote 必须逐字。
拿报出来的那条去原文里 grep，多半是省略了口语填充词。

## 备份与恢复

每天自动备份三个库，各留 14 份。**没有验证过恢复流程**——真要恢复：

```bash
docker exec -i fanisl-pg pg_restore -U fanisl -d fanisl_knowledge --clean \
  < /opt/fanisl/backups/fanisl_knowledge-YYYYMMDD-HHMMSS.dump
```

拉一份完整快照到本机（按需手动跑，不做定时，因为开发机会休眠）：

```bash
deploy/pull-snapshot.sh
```

## 定期该做的

| 频率 | 做什么 |
|---|---|
| 每次推送后 | 看一眼 `systemctl status fanisl-update`，failed 就处理 |
| 每周 | `check_ingest.py` 看摄取有没有断；看 `docs/plans/active/*.md` 各席位进度 |
| 每月 | `df -h`（现在 19%，很宽松）；确认备份还在生成 |
| 提取每批之后 | 抽查满 20%（§10），没抽完不开下一批 |

## 已知的账要还

这些不是故障，是知道但还没做的，详见 `plans/active/`：

- `backend/binance-ed25519.pem` 在服务器上属主/权限不对，API 启动时报 `Permission denied`
- 备份的**恢复流程从未验证过**
- 仓库是公开的，且历史里有过 Google 会话 cookie（`7f006b8` 加入、`08ac99e` 移除，
  两个提交都已推送）。轮换那个会话是唯一有效的补救，改写历史召不回已被克隆的副本
- 累计抽查 6.6%，v1 时期那 798 条尤其稀
