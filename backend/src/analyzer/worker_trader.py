"""trader 进程入口：自主交易调度。**两条独立调度线程**，互不阻塞：

- 快 loop（mark，15s）：纯确定性盯市——撮合限价、止损/止盈/强平、写快照、按 Claude 声明
  的唤醒条件触发重评。**绝不能被 Claude 卡住**，所以单独一条线程。
- 慢 loop（decision）：manage（响应待重评，调 Claude）+ scan（每 4h 自主找机会，调 Claude）。
  分钟级阻塞只发生在这条线程里，不影响盯市的及时性。

启动：`python -m analyzer.worker_trader`（systemd: fanisl-trader.service）。单实例。
"""

from __future__ import annotations

from . import runtime as rt
from .scheduler import Scheduler
from .worker_base import LOCK_TRADER, acquire_single_instance, run_workers


def main() -> None:
    if not rt.settings.trading_enabled:
        raise SystemExit("trading_enabled=false，trader 不启动。")
    acquire_single_instance(rt.trading_pool, LOCK_TRADER, "trader")
    svc, acct = rt.trading_service, rt.ACCOUNT_ID

    # 快线程：盯市（确定性，必须及时）
    fast = Scheduler([
        ("trading_mark", rt.settings.trading_mark_interval_s, lambda: svc.mark(acct)),
    ])
    # 慢线程：Claude 决策（管理 + 扫描），可阻塞，不碰盯市
    decision_jobs = [
        ("trading_manage", rt.settings.trading_tick_interval_s, lambda: svc.manage_and_review(acct)),
    ]
    if rt.settings.trading_scan_enabled:
        decision_jobs.append(
            ("trading_scan", rt.settings.trading_scan_interval_s, lambda: svc.scan(acct))
        )
    slow = Scheduler(decision_jobs)

    run_workers([fast, slow], name="trader")


if __name__ == "__main__":
    main()
