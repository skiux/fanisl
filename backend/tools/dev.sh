#!/usr/bin/env bash
# 本地开发起后端。**一条命令，不用记任何前缀。**
#
# 存在的理由：正确的启动方式带一个 FANISL_ENV_FILE 前缀，而靠人记前缀就一定会忘
# ——2026-09-03 就直接 `uvicorn` 起了一次，连的是生产库。
#
# 配置文件不入库（名字是凭据形态，见 tests/test_no_tracked_secrets.py），
# 所以首次运行时在这里生成。库用 tools/dev_db.sh 建。
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=.env.dev
if [[ ! -f $ENV_FILE ]]; then
  cat > "$ENV_FILE" <<'ENV'
# 本地开发的隔离配置，由 tools/dev.sh 生成。**不入库，也不要往里放机密。**
# 库用 tools/dev_db.sh 建。
PG_CONNINFO=dbname=fanisl_dev
PG_TRADING_CONNINFO=dbname=fanisl_dev_trading
PG_KNOWLEDGE_CONNINFO=dbname=fanisl_dev_knowledge
AUTH_ENABLED=false
AUTH_COOKIE_SECURE=false
ENV
  echo "已生成 $ENV_FILE"
fi

exec env FANISL_ENV_FILE="$ENV_FILE" PYTHONPATH=src \
  .venv/bin/uvicorn analyzer.main:app --host 127.0.0.1 --port "${PORT:-8000}" "$@"
