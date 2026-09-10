# 001 — 后台调度用墙钟，不用 time.monotonic()

**日期** 2026-06 · **状态** 生效 · **位置** `backend/fanisl/scheduler.py`

## 背景

`Scheduler` 按各 job 的 interval 到点触发（`knowledge_daily` 是 86400 秒）。
自然的写法是 `time.monotonic()`——单调、不受系统时钟调整影响。

## 决策

用墙钟 `time.time()` 计时，另配一个上界钳制兜住系统时钟被往回调的情况。

## 依据

macOS 上 `time.monotonic()` 走 `mach_absolute_time()`，**睡眠期间不走字**
（Linux 的 `CLOCK_MONOTONIC` 同样不含 suspend）。开发机实测：开机 9.2 天里
只清醒 52%，于是 `interval=86400` 的「每日」任务要约 **46 小时墙钟**才触发一次，
而且误差会一直累积。

我们要的语义是「每过 N 秒真实时间」，那就只能用墙钟。

## 后果

- 系统时钟被改会影响下一次触发，用上界钳制兜住（往回调时不至于把任务饿死）
- `run_immediately=True`：每次进程重启都会立刻补跑一轮全部 job。
  这是有意的（重启后前端马上有数据），但也意味着**服务器每次部署都会触发一次
  完整的日维护**，包括摄取
