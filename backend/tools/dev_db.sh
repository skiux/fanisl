#!/usr/bin/env bash
# 本地开发用的隔离库。
#
# 存在的理由：默认的 backend/.env 里 PG_CONNINFO 指着 5433——那是通到生产的 SSH 隧道。
# 隧道本身是有意的（提取/归并那条流程靠它），但**跑本地服务时连着它就是拿生产库开发**：
# 页面显示的是生产缓存的真实数字，而任何写入直接落在生产上。
#
# 这个脚本建三个空库并打印要 export 的环境变量。表结构不用管：各个 Store 构造时都会
# CREATE TABLE IF NOT EXISTS，空库自己会长出来。
set -euo pipefail

for db in fanisl_dev fanisl_dev_trading fanisl_dev_knowledge; do
  if psql -lqt | cut -d'|' -f1 | tr -d ' ' | grep -qx "$db"; then
    echo "已存在 $db"
  else
    createdb "$db" && echo "已建 $db"
  fi
done

cat <<'ENV'

把下面几行放进 backend/.env.dev，然后用它启动：

  PG_CONNINFO=dbname=fanisl_dev
  PG_TRADING_CONNINFO=dbname=fanisl_dev_trading
  PG_KNOWLEDGE_CONNINFO=dbname=fanisl_dev_knowledge
  AUTH_ENABLED=false

启动：

  cd backend && env $(grep -v '^#' .env.dev | xargs) \
    PYTHONPATH=src .venv/bin/uvicorn analyzer.main:app --port 8000

启动第一屏会打印连的是哪个库。看到 ⚠ 就说明还连着远端。
ENV
