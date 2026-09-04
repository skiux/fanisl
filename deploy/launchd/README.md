# 开发机（macOS）常驻服务

服务器侧用 systemd（见 `deploy/*.service` 与 `deploy/README.md`）。开发机是 macOS，
对应物是 launchd。

> **2026-08-18 上线后，本机这两个任务的角色都变了，别照旧开着：**
>
> - **collector 应当停掉**。服务器已接管知识引擎的日维护与周报；而本机 `.env` 的
>   `PG_KNOWLEDGE_CONNINFO` 现在指向 SSH 隧道，本机 collector 一跑就变成**第二个写服务器库
>   的进程**（隧道通时重复写、隧道断时刷错误日志）。它的 PG advisory lock 取在 `fanisl` 库上，
>   拦不住这种跨机重复。停：`launchctl bootout gui/$(id -u)/com.fanisl.collector`
> - **backup 备哪个库，看 `.env` 里的连接串。** 2026-09-04 起 `PG_CONNINFO` /
>   `PG_TRADING_CONNINFO` 已改指本机开发库（见 backend/README.md「本地开发用隔离的库」），
>   所以本机跑 backup 备的是本机库；只有 `PG_KNOWLEDGE_CONNINFO` 仍指隧道，
>   那是提取流程有意的。
>
>   曾经写过 `FANISL_ENV_FILE=/dev/null deploy/backup.sh` 这条建议——**那个环境变量
>   已经删掉了**（它是一层为了绕开"`.env` 指向生产"而搭的脚手架，后来把 `.env` 直接
>   改对了，脚手架就没必要了）。照着敲的话它会被静默忽略，脚本照常连 `.env` 里的库。
>
> 服务器侧的备份走 systemd timer，见 `deploy/README.md` §8。

## 为什么必须常驻

`collector` 是 knowledge 两个 job 的唯一宿主：

- `knowledge`（`knowledge/daily.py`）— 行情刷新 → 到期评分 → 节点状态重算，每日；
- `knowledge_weekly`（`knowledge/discovery.py`）— 周报，每周。

2026-08-14 排查：`collection_runs` 里最后一次记录是 **2026-06-14**，而这两个 job 是
7 月中 K5/K6 才挂上调度的——它们从来没有自动跑过。验证层因此静默停摆：判据到期没人评、
节点状态不重算、联赛表停在旧数字上，而界面上看不出任何异常。

## 安装

```
cp deploy/launchd/com.fanisl.collector.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.fanisl.collector.plist
```

`RunAtLoad` 登录即起，`KeepAlive` 崩了自动拉起（实测 kill -9 后由 launchd 重启）。

## 查看 / 停止

```
launchctl print gui/$(id -u)/com.fanisl.collector | grep -E 'state|pid|last exit'
tail -f ~/Library/Logs/fanisl-collector.log
launchctl bootout gui/$(id -u)/com.fanisl.collector     # 停止并卸载
```

## 几个已知行为，不是故障

- **手动再起一个会立刻自退**：`[collector] 已有同类 worker 在运行（advisory lock … 未取得）`。
  单实例是 PG advisory lock 保证的，plist 里 `ThrottleInterval=60` 防止这种情况下疯狂重启。
- **market job 每 15 分钟失败一次**：`GET https://api.binance.com/... 451`，Binance 地域封锁。
  best-effort 记 `ok=0` 后继续，不影响 knowledge 两个 job。这是另一件事，要修得换数据源。
- **日志里没有 knowledge job 的细节**：`daily.run_daily` 用 `log.info`，而 `logging.basicConfig`
  只在 `daily.main()` 里调——从调度器进来时没有 handler，INFO 被丢弃。`prices.refresh` 的
  `print` 能看到。要看完整过程就单独跑 `python -m analyzer.knowledge.daily`。

## 计时口径

`Scheduler` 的 interval 走**墙钟**（`time.time()`）而不是 `time.monotonic()`。macOS 上
`monotonic` 是 `mach_absolute_time()`，睡眠期间不走字；开发机实测开机 9.2 天里只清醒 52%，
用 monotonic 的话 `interval=86400` 的"每日"任务要约 46 小时墙钟才触发一次，且误差持续累积。
详见 `scheduler.py` 顶注与 `tests/test_scheduler.py`。
