# fanisl

个人交易工作台：多资产**时点正确**的数据平台 + Claude 盘面分析 + 交易评测台（实盘镜像、
按 setup 评 edge）+ 量化研究 harness（已收官，按需复用）。

单用户项目，实盘视角：股票 / 金银 / 原油（酌情交易），crypto 为研究与数据面。

## 现状一句话（2026-07-13）

23 个预注册假设全部 KILLED → "免费数据+系统化信号+散户成本"无可部署 edge
（[doc/research/research-capstone.md](doc/research/research-capstone.md)）。项目主线转向**知识引擎**：
持续获取金融创作者的图文/视频，提取为结构化知识单元并**用市场数据持续审计**
（发布时刻冻结 → 到期机械评分 → 信源联赛表），见 [doc/knowledge-engine-design.md](doc/knowledge-engine-design.md)。

## 结构

- `backend/` — FastAPI + PostgreSQL/TimescaleDB，三进程（api / collector / trader）。
  详见 [doc/project-structure.md](doc/project-structure.md)。
- `frontend/` — React/TS/Vite（对话、数据页、交易评测）。
- `doc/` — 设计、数据源、研究预注册与裁决日志。
- `deploy/` — systemd × 3 + nginx。

## 运行（本机 dev）

```bash
# 后端 API（需本地 PostgreSQL + backend/.env）
cd backend && PYTHONPATH=src .venv/bin/uvicorn analyzer.main:app --port 8000
# 采集 / 交易 worker（可选常驻）
PYTHONPATH=src .venv/bin/python -m analyzer.worker_collector
PYTHONPATH=src .venv/bin/python -m analyzer.worker_trader
# 前端
cd frontend && npm run dev            # http://localhost:5173
# 测试（用 fanisl_test 库）
cd backend && .venv/bin/python -m pytest -q
```

## 关键文档

完整索引见 [doc/README.md](doc/README.md)。

| 主题 | 文档 |
|---|---|
| 知识引擎（当前主线） | [doc/knowledge-engine-design.md](doc/knowledge-engine-design.md) |
| 研究收官（问题/方法/23 裁决/遗产） | [doc/research/research-capstone.md](doc/research/research-capstone.md) |
| 逐假设裁决日志 | [doc/research/research-log.md](doc/research/research-log.md) |
| 评测台重定位（setup/闸门/实盘镜像） | [doc/trading-eval-repositioning.md](doc/trading-eval-repositioning.md) |
| 数据源现状与缺口 | [doc/data/data-gaps.md](doc/data/data-gaps.md) |
| 代码结构详解 | [doc/project-structure.md](doc/project-structure.md) |
