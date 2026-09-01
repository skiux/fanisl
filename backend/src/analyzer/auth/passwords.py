"""口令散列与校验：stdlib 的 scrypt。

**为什么不用 argon2-cffi / bcrypt**：两者都是编译扩展，服务器上多一个编译依赖就多一处
升级摩擦（这台机器的部署方式是 venv + git pull，见 deploy/README）。scrypt 是内存硬的
KDF，由 OpenSSL 实现、随 Python 一起来，抗 GPU 爆破的性质与 argon2 同一量级。对一个
三五个用户的登录端点，这个取舍是划算的。

参数 n=2**15, r=8, p=1 → 32 MiB / 本机实测 77 ms（服务器上更慢，仍在可接受范围）。
存储格式 `scrypt$n$r$p$salt_b64$dk_b64`，把参数写进串里——将来调参不必迁移旧口令，
校验时按串里的参数算。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os

_N = 2**15
_R = 8
_P = 1
_DKLEN = 32
_SALT_BYTES = 16
# OpenSSL 默认 maxmem 是 32 MiB，恰好卡在 n=2**15 的用量上，必须显式放开
_MAXMEM = _N * _R * 128 * 4

_B64 = base64.b64encode
_UNB64 = base64.b64decode


def _derive(password: str, salt: bytes, *, n: int, r: int, p: int, dklen: int) -> bytes:
    return hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=dklen,
        maxmem=max(_MAXMEM, n * r * 128 * 4),
    )


def hash_password(password: str) -> str:
    salt = os.urandom(_SALT_BYTES)
    dk = _derive(password, salt, n=_N, r=_R, p=_P, dklen=_DKLEN)
    return f"scrypt${_N}${_R}${_P}${_B64(salt).decode()}${_B64(dk).decode()}"


def verify_password(password: str, stored: str) -> bool:
    """恒定时间比较。串格式不对一律返回 False，不抛——调用方只关心"能不能进"。"""
    try:
        scheme, n_s, r_s, p_s, salt_b64, dk_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        n, r, p = int(n_s), int(r_s), int(p_s)
        salt, expected = _UNB64(salt_b64), _UNB64(dk_b64)
    except (ValueError, TypeError):
        return False
    try:
        actual = _derive(password, salt, n=n, r=r, p=p, dklen=len(expected))
    except ValueError:
        return False
    return hmac.compare_digest(actual, expected)


def needs_rehash(stored: str) -> bool:
    """存的参数比当前默认弱时为 True——登录成功那一刻是唯一能拿到明文口令、
    可以顺手升级的时机。"""
    try:
        scheme, n_s, r_s, p_s, _salt, _dk = stored.split("$")
    except ValueError:
        return True
    return scheme != "scrypt" or (int(n_s), int(r_s), int(p_s)) != (_N, _R, _P)
