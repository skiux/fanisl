#!/usr/bin/env bash
# 自动更新：origin/main 有新提交就拉取、按需重装依赖与重建前端、验证通过后重启。
# 由 fanisl-update.timer 调用，以 fanisl 身份运行；重启走 /etc/sudoers.d/fanisl-update 那条窄规则。
# 手动跑一次：sudo -u fanisl /opt/fanisl/deploy/auto-update.sh
#
# 只在对应部分真的变了才动它：后端变了才重启（**重启会让 Scheduler 的 run_immediately
# 立刻触发全部 job**，包括知识引擎日维护与周报，所以不能每次都重启）；某个前端变了才重建。
set -uo pipefail

REPO=/opt/fanisl
BRANCH=main
HEALTH=http://127.0.0.1:8000/health
UNITS=(fanisl-api fanisl-collector)

cd "$REPO" || exit 1

# 单实例：构建慢，定时器可能在上一轮没跑完时又触发
exec 9>/tmp/fanisl-update.lock
flock -n 9 || exit 0

changed() { grep -q "^$1" <<<"$CHANGED"; }
restart() { sudo -n systemctl restart "${UNITS[@]}"; }

# 脏树上 pull 会失败或产生冲突。宁可停下报出来，也不静默丢弃改动。
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "工作区有未提交改动，跳过本轮："
    git status --short --untracked-files=no
    exit 0
fi

git fetch --quiet origin "$BRANCH" || { echo "fetch 失败"; exit 1; }
OLD=$(git rev-parse HEAD)
NEW=$(git rev-parse "origin/$BRANCH")
[ "$OLD" = "$NEW" ] && exit 0

echo "新提交 ${OLD:0:7} -> ${NEW:0:7}"
CHANGED=$(git diff --name-only "$OLD" "$NEW")

# 未追踪文件也会挡住 merge，而上面那道脏树检查用的是 --untracked-files=no、看不见它们。
# 2026-08-28 引导时 auto-update.sh 是 scp 上来的，等它自己的提交推上来，merge 就一直报
# "untracked working tree files would be overwritten"——自动更新被自己的引导产物挡了三天。
# 内容与来件逐字节相同的，删掉即可（merge 会把同样的内容放回来）；不同的一律停下报出来。
while IFS= read -r f; do
    [ -e "$REPO/$f" ] || continue
    git ls-files --error-unmatch "$f" >/dev/null 2>&1 && continue
    if git show "origin/$BRANCH:$f" 2>/dev/null | cmp -s - "$REPO/$f"; then
        echo "  清理同内容的未追踪文件：$f"
        rm -f "$REPO/$f"
    else
        echo "未追踪文件与来件同路径但内容不同，需人工处理：$f"
        exit 1
    fi
done <<<"$CHANGED"

# 失败原因要如实报出来。此前无论什么原因都打 "非快进合并"，把上面那个未追踪冲突
# 误导成了分叉问题，日志因此看了也白看。
if ! merge_err=$(git merge --ff-only "origin/$BRANCH" 2>&1); then
    echo "merge 失败，需人工处理："
    echo "$merge_err" | sed 's/^/    /'
    exit 1
fi

rollback() {
    echo "回滚到 ${OLD:0:7}"
    git reset --hard --quiet "$OLD"
    "$REPO/backend/.venv/bin/pip" install -q -e "$REPO/backend"
    restart
}

# 后端：先装依赖，再验证能 import，最后重启并查健康。任一步失败即回滚。
if changed "backend/"; then
    if changed "backend/pyproject.toml"; then
        echo "pyproject 变了，重装依赖"
        "$REPO/backend/.venv/bin/pip" install -q -e "$REPO/backend" || { rollback; exit 1; }
    fi
    # 必须在 backend/ 下跑：runtime 模块级就建连接池，而 .env 是相对 backend/ 解析的，
    # 在别处 import 会拿默认连接串、连不上库超时 30 秒，看起来像"新代码坏了"。
    if ! (cd "$REPO/backend" && PYTHONPATH=src .venv/bin/python -c "import analyzer.main"); then
        echo "新代码 import 失败"; rollback; exit 1
    fi
    restart
    sleep 5
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH")
    [ "$code" = "200" ] || { echo "健康检查返回 $code"; rollback; exit 1; }
    echo "后端已更新"
fi

# 前端：构建失败时把 dist 换回旧版，不能让站点停在半份产物上。
for app in frontend console; do
    changed "$app/" || continue
    echo "重建 $app"
    cd "$REPO/$app" || continue
    changed "$app/package-lock.json" && npm ci --silent
    rm -rf dist.bak && cp -r dist dist.bak 2>/dev/null
    if VITE_API_BASE= npm run build >/dev/null 2>&1; then
        rm -rf dist.bak
        echo "$app 已重建"
    else
        echo "$app 构建失败，dist 保持旧版"
        rm -rf dist && mv dist.bak dist
    fi
    cd "$REPO" || exit 1
done

echo "更新完成 -> ${NEW:0:7}"
