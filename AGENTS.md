# fanisl — 会话须知

> 本文是每个会话开机第一眼要看的东西。Claude Code 与 Codex 都读它
> （`CLAUDE.md` 是指向本文的符号链接，只此一份，别分叉）。
> 详细约定见 [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md)，结构见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 一、这个仓库是两个产品共用一个底座

不要按「前端 / 后端」理解这个仓库，那会把边界切错。

| | 后端 | 前端 | 线上位置 |
|---|---|---|---|
| **知识引擎** | `backend/fanisl/knowledge/` | `frontend/` | `fanisl.skiuo.com/` |
| **交易台** | `backend/fanisl/trading/` + `binance/` | `console/` | `fanisl.skiuo.com/console/` |
| **共用底座** | `backend/fanisl/` 包根 + `collect/` `chat/` `data/` `auth/` `tools/` | `shared/` | — |

`frontend/` 这个名字是历史遗留,**它不是「那个前端」,它是知识引擎的站点**。
`console/` 是独立的交易台应用,两者只共用 `shared/login/` 一个登录页。

## 二、会话归属

多个会话并行开发。**冲突按文件发生,不按功能发生**,所以归属按文件划:

| 会话 | 拥有（可改） | 交付 |
|---|---|---|
| **知识引擎** | `backend/fanisl/knowledge/**`、`backend/fanisl/assets.py`、`frontend/**`、`data_export/knowledge_units/`、`docs/research/**` | L0→L6 的正确性、站点 |
| **交易台** | `backend/fanisl/trading/**`、`backend/fanisl/binance/**`、`console/**` | 账户、订单、风控 |
| **底座与运维** | `backend/fanisl/` 包根、`collect/` `chat/` `data/` `auth/` `tools/`、`backend/api.md`、`shared/**`、`deploy/**` | 服务可用、合约稳定 |

三条规则：

1. **合约文件只有一个主人,主人是生产方不是消费方。**
   `backend/api.md` 归底座会话;`backend/fanisl/assets.py` 归知识引擎
   （它是标的登记表,而发现新标的的是提取管线,前端只是读方）。
2. **跨界需求写进 `docs/plans/active/`,不直接改。** 曾经因为归属不清,
   `assets.py` 被冻了一周多,十几个标的没登记、对应单元在标的页上不可见。
3. **两份冻结规范由知识引擎会话维护**：`backend/fanisl/knowledge/extraction-guide.md`
   与 `merge-guide.md`。改动必须升 `extractor_version` 并说明,别人不要动。

「回答杂项问题 / 市场分析」那类会话不占代码席位——它要的是只读库权限和好文档。

## 三、怎么跑

```bash
# 后端（仓库根下）
cd backend && source .venv/bin/activate
PYTHONPATH=. uvicorn fanisl.main:app --reload      # API
python -m pytest tests -q                          # 534 测试，改后端必跑

# 两个前端
cd frontend && npm run dev      # 知识引擎站点
cd console  && npm run dev      # 交易台
npm run test && npm run typecheck                   # 改前端必跑

# 库连通性 / 摄取健康度（只读，不摄取）
cd backend && PYTHONPATH=. python tools/check_db.py
cd backend && PYTHONPATH=. python tools/check_ingest.py
```

**知识库是远端的**：本机三个库里只有 `PG_KNOWLEDGE_CONNINFO` 走 SSH 隧道连服务器
（唯一真库）,`PG_CONNINFO` / `PG_TRADING_CONNINFO` 指向本机的空 dev 库。
所以在本机跑 `check_ingest.py`,前两节显示为空是正常的,不代表服务器采集停了。

## 四、几条容易踩的

- **服务器每 5 分钟自动拉 `origin/main` 并重启服务。** 推上去的东西会很快上线,
  失败会自动回滚（`deploy/auto-update.sh`）。
- **改了 systemd unit 要 `daemon-reload`**,auto-update 不做这一步。
- **文档是交付物的一部分。** 改了行为就同步改文档;模块文档贴着实现放,
  `docs/` 只放跨模块的。理由见 `docs/CONVENTIONS.md`。
- **提取产出的 quote 必须逐字**,导入时机械校验 `quote ∈ 原文`,不过就整文件拒绝。
