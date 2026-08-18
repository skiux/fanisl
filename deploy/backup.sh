#!/usr/bin/env bash
# 备份 fanisl 的 Postgres 库（自定义格式，pg_restore 可选表恢复）。
# 本机与服务器通用。cron/launchd 直接调这个脚本即可。
set -euo pipefail

DEST="${FANISL_BACKUP_DIR:-$HOME/fanisl-backups}"
KEEP="${FANISL_BACKUP_KEEP:-14}"
DBS="${FANISL_BACKUP_DBS:-fanisl_knowledge fanisl fanisl_trading}"

mkdir -p "$DEST"
stamp=$(date +%Y%m%d-%H%M%S)

for db in $DBS; do
    out="$DEST/$db-$stamp.dump"
    pg_dump -Fc -d "$db" -f "$out"
    echo "$db  $(du -h "$out" | cut -f1)  $out"
done

# 每个库各自保留最近 KEEP 份
for db in $DBS; do
    ls -1t "$DEST/$db-"*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
        rm -- "$old"
        echo "清理 $old"
    done
done
