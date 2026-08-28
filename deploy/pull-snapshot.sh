#!/usr/bin/env bash
# 从服务器拉一份完整快照到本机（三个库的 dump + 关键帧）。想起来就跑，不做定时。
#
# 为什么要有：GCP 控制台已不可用，那台 VM 全靠一把带密码短语的 SSH 密钥撑着，
# 且加不了新的正式入口。服务器仍是唯一活库，本机这份是**只读快照**——它不参与
# 任何流程，不需要维护，只需要存在。
set -euo pipefail

HOST="${FANISL_HOST:-enin@35.240.252.205}"
KEY="${FANISL_SSH_KEY:-$HOME/.ssh/google_compute_engine}"
DEST="${FANISL_SNAPSHOT_DIR:-$HOME/fanisl-backups}"
FRAMES="${FANISL_FRAMES_DIR:-$HOME/fanisl-keyframes}"
SSH=(ssh -i "$KEY" -o ConnectTimeout=15)

mkdir -p "$DEST" "$FRAMES"
stamp=$(date +%Y%m%d-%H%M%S)

echo "[1/3] 服务器上导出三个库…"
"${SSH[@]}" "$HOST" 'cd /opt/fanisl && FANISL_BACKUP_DIR=/tmp/snapshot ./deploy/backup.sh' | sed 's/^/      /'

echo "[2/3] 拉回 dump…"
scp -q -i "$KEY" "$HOST:/tmp/snapshot/*.dump" "$DEST/"
"${SSH[@]}" "$HOST" 'rm -rf /tmp/snapshot'
ls -1t "$DEST"/*-"${stamp%-*}"*.dump 2>/dev/null | sed 's/^/      /' || ls -1t "$DEST"/*.dump | head -3 | sed 's/^/      /'

# 帧目录以服务器 .env 的 KEYFRAME_ROOT 为准，别写死——服务器上 data/keyframes 与
# data_export/keyframes 两个目录都存在，实际在用的是前者，后者是空壳。
# 服务器没装 rsync，用 tar 走 ssh 管道。
echo "[3/3] 同步关键帧（tar over ssh，服务器无 rsync）…"
ROOT=$("${SSH[@]}" "$HOST" 'sed -n "s/^KEYFRAME_ROOT=//p" /opt/fanisl/backend/.env | tail -1')
ROOT="${ROOT:-/opt/fanisl/data_export/keyframes}"
echo "      源: $ROOT"
"${SSH[@]}" "$HOST" "tar czf - --ignore-failed-read -C \"\$(dirname $ROOT)\" \"\$(basename $ROOT)\" 2>/dev/null" \
  | tar xzf - -C "$FRAMES" --strip-components=1
echo "      $(find "$FRAMES" -name '*.jpg' | wc -l | tr -d ' ') 帧，$(du -sh "$FRAMES" | cut -f1)"

echo
echo "完成。dump → $DEST"
echo "      帧 → $FRAMES"
