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
    svc = rt.trading_service
    all_ids = [a["id"] for a in rt.ACCOUNTS]
    managed_ids = [a["id"] for a in rt.ACCOUNTS if a["managed"]]
    setup_ids = [a["id"] for a in rt.ACCOUNTS if a["spec"].setups]

    def mark_all() -> list:
        out = []
        for aid in all_ids:
            out += svc.mark(aid)
        # 影子账户：把被镜像账户的新计划机械复制过来（无 Claude）
        svc.sync_shadows(rt.ACCOUNTS)
        return out

    def manage_all() -> list:
        return [svc.manage_and_review(aid) for aid in managed_ids]

    def scan_all() -> list:
        return [svc.scan(aid) for aid in managed_ids]

    def setups_all() -> list:
        # setup 探测（触发→闸门→开仓）+ 到期 veto 假想校验，同一节奏跑
        return [{"detected": svc.detect_setups(aid), "vetoes": svc.verify_vetoes(aid)}
                for aid in setup_ids]

    # 快线程：盯市（确定性，必须及时）——所有账户
    fast = Scheduler([
        ("trading_mark", rt.settings.trading_mark_interval_s, mark_all),
    ])
    # 慢线程：Claude 决策（管理 + 扫描），可阻塞，不碰盯市——仅被管理账户
    decision_jobs = [
        ("trading_manage", rt.settings.trading_tick_interval_s, manage_all),
    ]
    if rt.settings.trading_scan_enabled:
        decision_jobs.append(("trading_scan", rt.settings.trading_scan_interval_s, scan_all))
    if rt.settings.trading_setups_enabled and setup_ids:
        decision_jobs.append(("trading_setups", rt.settings.trading_setup_interval_s, setups_all))
    slow = Scheduler(decision_jobs)

    run_workers([fast, slow], name="trader")


if __name__ == "__main__":
    main()
