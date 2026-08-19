#!/usr/bin/env bash
# 备份 fanisl 的 Postgres 库（自定义格式，pg_restore 可选表恢复）。本机与服务器通用。
#
# 连接串直接复用 backend/.env 里的 PG_*_CONNINFO——那是应用唯一的连接配置来源。
# 不要另立一份：2026-08-19 曾用单独的 .env.backup 传 PGHOST，漏掉就静默退回 Unix socket，
# 而 Docker 部署下宿主机根本没有 socket，表现是 pg_dump 报 .s.PGSQL.5432 不存在。
set -euo pipefail

# launchd / systemd 都不继承交互 shell 的 PATH（实测 launchctl getenv PATH 为空），
# 而 pg_dump 在 Homebrew 下是 /opt/homebrew/bin。不补这一行，任务会以 127
# "command not found" 静默失败——2026-08-18 起本机备份就是这么断的，日志不看就发现不了。
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/pgsql-17/bin:$PATH"
command -v pg_dump >/dev/null || { echo "找不到 pg_dump；把它所在目录加进上面的 PATH" >&2; exit 127; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${FANISL_ENV_FILE:-$HERE/../backend/.env}"
DEST="${FANISL_BACKUP_DIR:-$HOME/fanisl-backups}"
KEEP="${FANISL_BACKUP_KEEP:-14}"

# 从 .env 取一个键的值（去掉可能的引号）；缺键返回空
env_get() {
    [ -f "$ENV_FILE" ] || return 0
    sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" \
        | tail -1 | sed 's/^["'\'']//; s/["'\'']$//'
}

declare -a NAMES CONNS
add() {
    local name="$1" conn="$2"
    [ -n "$conn" ] || conn="dbname=$name"        # .env 缺项时退回本地默认（开发机 socket）
    NAMES+=("$name"); CONNS+=("$conn")
}
add fanisl_knowledge "$(env_get PG_KNOWLEDGE_CONNINFO)"
add fanisl           "$(env_get PG_CONNINFO)"
add fanisl_trading   "$(env_get PG_TRADING_CONNINFO)"

mkdir -p "$DEST"
stamp=$(date +%Y%m%d-%H%M%S)

for i in "${!NAMES[@]}"; do
    db="${NAMES[$i]}"
    out="$DEST/$db-$stamp.dump"
    pg_dump -Fc -d "${CONNS[$i]}" -f "$out"
    echo "$db  $(du -h "$out" | cut -f1)  $out"
done

# 每个库各自保留最近 KEEP 份
for db in "${NAMES[@]}"; do
    ls -1t "$DEST/$db-"*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
        rm -- "$old"
        echo "清理 $old"
    done
done
