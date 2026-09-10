"""Binance 请求签名：HMAC / Ed25519 / RSA 三种 key 类型。

官方把 **HMAC 标为 deprecated**，推荐 Ed25519（密钥更小、签名更快、私钥不出本机）。
这里三种都支持，按配置自动判型——换 key 类型只改 `.env`，代码不用动。

两处**不一样、写错了就恒 401** 的地方：

1. **编码不同**：HMAC 出 hex，非对称出 **base64**。
2. **base64 必须再 percent-encode**：签名里会出现 `+` `/` `=`，直接拼进 query string 的话
   `+` 会被服务端解成空格，签名当场对不上。hex 是纯字母数字，编不编都一样，
   所以这里**无条件编码**——少一个分支，也不会因为"HMAC 时忘了编码"而出现只在某种
   key 类型下才复现的 bug。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
from pathlib import Path
from typing import Protocol


class Signer(Protocol):
    kind: str

    def sign(self, payload: str) -> str: ...


class HmacSigner:
    """对称密钥。官方已标 deprecated，但存量 key 仍然可用。"""

    kind = "HMAC"

    def __init__(self, secret: str) -> None:
        self._secret = secret.encode("utf-8")

    def sign(self, payload: str) -> str:
        return hmac.new(self._secret, payload.encode("utf-8"),
                        hashlib.sha256).hexdigest()


class Ed25519Signer:
    """官方推荐。PureEdDSA：内部自己做哈希，**不要**再套 SHA-256。"""

    kind = "Ed25519"

    def __init__(self, private_key) -> None:  # noqa: ANN001 — cryptography 的类型
        self._key = private_key

    def sign(self, payload: str) -> str:
        return base64.b64encode(self._key.sign(payload.encode("ASCII"))).decode("ascii")


class RsaSigner:
    """RSASSA-PKCS1-v1_5 + SHA-256，与官方文档里的 `openssl dgst -sha256 -sign` 一致。"""

    kind = "RSA"

    def __init__(self, private_key) -> None:  # noqa: ANN001
        self._key = private_key

    def sign(self, payload: str) -> str:
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding

        signature = self._key.sign(payload.encode("ASCII"), padding.PKCS1v15(),
                                   hashes.SHA256())
        return base64.b64encode(signature).decode("ascii")


class KeyLoadError(Exception):
    """私钥读不出来。配置问题，应当在启动时就说清楚，而不是等到第一次请求 401。"""


def load_private_key(path: str, passphrase: str = ""):  # noqa: ANN201
    from cryptography.hazmat.primitives.serialization import load_pem_private_key

    pem = Path(path).expanduser()
    if not pem.is_file():
        raise KeyLoadError(f"私钥文件不存在: {pem}")
    try:
        data = pem.read_bytes()
    except OSError as e:
        # 最常见的一种：私钥是用自己的账号建的（chmod 600），而服务以 fanisl 身份跑，
        # 它读不了。报错要直接说出该怎么办，不然只看到一句 Permission denied。
        raise KeyLoadError(
            f"私钥读不了: {e}。服务以 fanisl 身份运行，确认属主与权限："
            f"sudo chown fanisl:fanisl {pem} && sudo chmod 600 {pem}") from e
    try:
        return load_pem_private_key(
            data, password=passphrase.encode("utf-8") if passphrase else None)
    except (ValueError, TypeError) as e:
        hint = "（这个私钥带口令，要配 BINANCE_PRIVATE_KEY_PASSPHRASE）" if not passphrase else ""
        raise KeyLoadError(f"私钥读取失败: {e}{hint}") from e


def build_signer(*, api_secret: str = "", private_key_path: str = "",
                 passphrase: str = "") -> Signer | None:
    """按配置判型。两样都配了以私钥为准——非对称更强，不该被一个遗留的 secret 顶掉。"""
    if private_key_path:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey

        key = load_private_key(private_key_path, passphrase)
        if isinstance(key, Ed25519PrivateKey):
            return Ed25519Signer(key)
        if isinstance(key, RSAPrivateKey):
            return RsaSigner(key)
        raise KeyLoadError(
            f"不支持的私钥类型 {type(key).__name__}；Binance 只认 Ed25519 与 RSA")
    if api_secret:
        return HmacSigner(api_secret)
    return None
