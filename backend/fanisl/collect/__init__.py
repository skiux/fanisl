"""采集管线：metric 登记表（SSOT）→ 抓取 → 校验 → 摊平 → 写时间序列，外加历史回填与摘要。

进程入口仍在包根的 `worker_collector.py`（systemd ExecStart 写死了模块路径，别挪）。
时间序列的读写在包根的 `marketstore.py`——它是很多模块共读的存储层，不属于本管线。
"""
