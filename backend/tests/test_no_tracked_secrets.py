"""被 git 追踪的文件里不许出现凭据。

2026-08-14 复核发现 backend/cookies.txt 曾被提交（7f006b8 加入、08ac99e 移除），而这两个
提交都已推到 origin/main——里面是 __Secure-3PSID / __Secure-3PAPISID 这类 **Google 账号
会话 cookie**，不是 YouTube 偏好设置。.gitignore 事后补上了 `**/cookies.txt`，但它只管未来，
管不了已经进了历史的那份。

这个测试守的是"未来"那一半：任何凭据形态的文件一旦被 git add，这里立刻红。
（历史里那份得靠轮换凭据 + 需要时重写历史，不是测试能解决的。）
"""

import re
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]

# 文件名形态：cookies.txt / .env / *.pem / id_rsa 之类
_SECRET_NAMES = re.compile(
    r"(^|/)("
    r"cookies\.txt|\.env(\..*)?|.*\.pem|.*\.p12|.*\.pfx|id_rsa|id_ed25519|"
    r".*credentials\.json|.*service[-_]account.*\.json"
    r")$", re.IGNORECASE)
# .env.example 这类模板是有意入库的
_ALLOW = re.compile(r"\.env\.example$|\.env\.sample$|\.env\.template$", re.IGNORECASE)

# 内容形态：要匹配**带值**的凭据，不是提到它的名字。
# （.gitignore 里那句"内含 __Secure-3PSID 等 Google 会话凭据"是说明文字，不该命中；
#  .env.example 里的 `ANTHROPIC_API_KEY=sk-` 占位符同理。）
_SECRET_CONTENT = [
    (re.compile(r"__Secure-\d?PSID\S*\s+\S{20,}"), "Google 账号会话 cookie（带值）"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "私钥"),
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{24,}"), "API key（带值）"),
    (re.compile(r"\bghp_[A-Za-z0-9]{30,}"), "GitHub token（带值）"),
]


def _tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=REPO, capture_output=True, text=True)
    if out.returncode != 0:
        pytest.skip("不在 git 仓库里")
    return [ln for ln in out.stdout.splitlines() if ln]


def test_no_credential_shaped_filenames_are_tracked():
    bad = [f for f in _tracked_files() if _SECRET_NAMES.search(f) and not _ALLOW.search(f)]
    assert not bad, f"这些凭据形态的文件被 git 追踪了：{bad}"


def test_no_credential_content_in_tracked_text_files():
    offenders = []
    for f in _tracked_files():
        p = REPO / f
        if not p.is_file() or p.stat().st_size > 512_000:
            continue
        if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".pdf",
                                ".zip", ".gz", ".woff", ".woff2", ".ttf"}:
            continue
        try:
            text = p.read_text(errors="ignore")
        except OSError:
            continue
        for pat, label in _SECRET_CONTENT:
            if pat.search(text):
                offenders.append(f"{f}（{label}）")
                break
    assert not offenders, f"追踪中的文件里出现凭据：{offenders}"
