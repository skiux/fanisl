"""三种 key 类型的签名。

官方把 HMAC 标为 deprecated、推荐 Ed25519，所以三种都要能用，换类型只改 .env。
这一组盯两件写错就恒 401 的事：**编码不同**（hex vs base64），
以及 **base64 必须再 percent-encode**（`+` 不编码会被服务端解成空格）。
"""

import base64
import urllib.parse

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric import ed25519, rsa
from cryptography.hazmat.primitives.serialization import (
    BestAvailableEncryption, Encoding, NoEncryption, PrivateFormat,
)

from analyzer.binance.client import BinanceClient, CredentialsMissing
from analyzer.binance.signing import KeyLoadError, build_signer


def write_pem(tmp_path, key, passphrase: str = ""):
    enc = BestAvailableEncryption(passphrase.encode()) if passphrase else NoEncryption()
    path = tmp_path / "prv.pem"
    path.write_bytes(key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, enc))
    return str(path)


# --- 判型 -----------------------------------------------------------------

def test_hmac_when_only_secret_is_configured():
    assert build_signer(api_secret="s").kind == "HMAC"


def test_ed25519_and_rsa_are_detected_from_the_pem(tmp_path):
    ed = write_pem(tmp_path, ed25519.Ed25519PrivateKey.generate())
    assert build_signer(private_key_path=ed).kind == "Ed25519"

    rsa_dir = tmp_path / "rsa"
    rsa_dir.mkdir()
    rsa_path = write_pem(rsa_dir, rsa.generate_private_key(
        public_exponent=65537, key_size=2048))
    assert build_signer(private_key_path=rsa_path).kind == "RSA"


def test_private_key_wins_over_a_leftover_secret(tmp_path):
    """非对称更强，不该被一个遗留的 secret 顶掉。"""
    pem = write_pem(tmp_path, ed25519.Ed25519PrivateKey.generate())
    assert build_signer(api_secret="old", private_key_path=pem).kind == "Ed25519"


def test_nothing_configured_returns_none():
    assert build_signer() is None


# --- 编码 -----------------------------------------------------------------

def test_hmac_signature_is_hex():
    sig = build_signer(api_secret="secret").sign("a=1&b=2")
    assert len(sig) == 64 and all(c in "0123456789abcdef" for c in sig)


def test_ed25519_signature_is_base64_and_verifies(tmp_path):
    key = ed25519.Ed25519PrivateKey.generate()
    sig = build_signer(private_key_path=write_pem(tmp_path, key)).sign("a=1&b=2")
    raw = base64.b64decode(sig)
    assert len(raw) == 64                      # Ed25519 签名固定 64 字节
    key.public_key().verify(raw, b"a=1&b=2")   # 验不过会抛


def test_rsa_signature_is_base64_and_verifies(tmp_path):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    sig = build_signer(private_key_path=write_pem(tmp_path, key)).sign("a=1&b=2")
    key.public_key().verify(base64.b64decode(sig), b"a=1&b=2",
                            padding.PKCS1v15(), hashes.SHA256())


# --- 拼进 URL 时的编码（写错就恒 401）--------------------------------------

class _FixedSigner:
    """签名固定成一个**确实含 `+` `/` `=`** 的串。

    第一版这条测试是拿"随机生成密钥直到签名里带 +/"来构造的，而且探测用的载荷
    与实际请求签的载荷不是同一个（后者带真实时间戳）——于是它单独跑碰巧过、
    全量跑碰巧挂。断言该验的是编码这条规则，不是运气。
    """

    kind = "Ed25519"
    VALUE = "ab+cd/ef=="

    def sign(self, payload: str) -> str:
        return self.VALUE


def test_base64_signature_is_percent_encoded_in_the_query():
    """base64 里有 `+` `/` `=`。不编码的话 `+` 会被服务端解成空格，签名当场对不上。"""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/time"):
            return httpx.Response(200, json={"serverTime": 0})
        seen["url"] = str(request.url)
        seen["decoded"] = dict(request.url.params).get("signature")
        return httpx.Response(200, json=[])

    client = BinanceClient("k", signer=_FixedSigner(),
                           client=httpx.Client(transport=httpx.MockTransport(handler)))
    client.signed_get("https://api.binance.com", "/api/v3/account")
    client.close()

    raw = seen["url"].split("signature=")[1]
    assert raw == "ab%2Bcd%2Fef%3D%3D"          # 三个字符都编了
    assert "+" not in raw and "/" not in raw
    # 服务端解出来必须还原成原始签名，否则验签必失败
    assert seen["decoded"] == _FixedSigner.VALUE
    assert urllib.parse.unquote(raw) == _FixedSigner.VALUE


def test_real_ed25519_signature_survives_the_url_roundtrip(tmp_path):
    """真密钥走一遍完整链路：签的载荷与服务端拿到的载荷必须逐字节一致。"""
    key = ed25519.Ed25519PrivateKey.generate()
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/time"):
            return httpx.Response(200, json={"serverTime": 0})
        query = str(request.url).split("?", 1)[1]
        seen["payload"] = query.split("&signature=")[0]
        seen["sig"] = dict(request.url.params)["signature"]
        return httpx.Response(200, json=[])

    client = BinanceClient("k", private_key_path=write_pem(tmp_path, key),
                           client=httpx.Client(transport=httpx.MockTransport(handler)))
    client.signed_get("https://api.binance.com", "/api/v3/account")
    client.close()

    key.public_key().verify(base64.b64decode(seen["sig"]),
                            seen["payload"].encode("ascii"))


def test_hex_signature_survives_the_same_encoding_path():
    """hex 编不编都一样——无条件编码是为了少一个分支，不是为了 hex。"""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        # 对时那一发是公开端点、不签名，别把它当成待验的请求
        if request.url.path.endswith("/time"):
            return httpx.Response(200, json={"serverTime": 0})
        seen["sig"] = str(request.url).split("signature=")[1]
        return httpx.Response(200, json=[])

    client = BinanceClient("k", "secret",
                           client=httpx.Client(transport=httpx.MockTransport(handler)))
    client.signed_get("https://api.binance.com", "/api/v3/account")
    client.close()
    assert "%" not in seen["sig"] and len(seen["sig"]) == 64


# --- 配置出错时的提示 ------------------------------------------------------

def test_missing_credentials_names_both_options():
    """提示要说清"要么 secret 要么私钥"，否则只配了 key 的人不知道还差什么。"""
    client = BinanceClient("only-api-key")
    with pytest.raises(CredentialsMissing) as e:
        client.signed_get("https://api.binance.com", "/api/v3/account")
    assert "BINANCE_API_SECRET" in str(e.value)
    assert "BINANCE_PRIVATE_KEY_PATH" in str(e.value)


def test_missing_key_file_says_so(tmp_path):
    with pytest.raises(KeyLoadError, match="不存在"):
        build_signer(private_key_path=str(tmp_path / "nope.pem"))


def test_encrypted_key_without_passphrase_says_what_to_configure(tmp_path):
    """光报"读取失败"没用——要说出缺的是哪个配置项。"""
    pem = write_pem(tmp_path, ed25519.Ed25519PrivateKey.generate(), passphrase="pw")
    with pytest.raises(KeyLoadError, match="BINANCE_PRIVATE_KEY_PASSPHRASE"):
        build_signer(private_key_path=pem)
    assert build_signer(private_key_path=pem, passphrase="pw").kind == "Ed25519"


# --- 配置出错不许把进程带崩 -------------------------------------------------
#
# runtime 在模块 import 时就建 BinanceClient，所以构造函数里的任何异常都会让**整个 API
# 起不来**。2026-09-02 线上 502 就是这么来的：私钥用自己的账号建、chmod 600，
# 而服务以 fanisl 身份跑，读不了 → PermissionError → import 失败 → 全站 502。
# 配置错误必须降级成"这个来源 unauthorized"，而不是"服务起不来"。

@pytest.mark.parametrize("kwargs", [
    {"private_key_path": "/definitely/not/here.pem"},
    {"private_key_path": "/tmp"},                       # 是目录不是文件
    {"private_key_path": "", "api_secret": ""},         # 什么都没配
])
def test_bad_key_config_never_raises_at_construction(kwargs):
    client = BinanceClient("k", **kwargs)               # 不抛就是通过
    assert client.signer is None
    assert client.credential_status


def test_unreadable_key_degrades_and_says_how_to_fix(tmp_path):
    import os

    pem = tmp_path / "locked.pem"
    pem.write_bytes(b"whatever")
    os.chmod(pem, 0o000)
    try:
        client = BinanceClient("k", private_key_path=str(pem))
        assert client.signer is None
        # 只说 Permission denied 没用，要说出该改属主还是改权限
        assert "chown" in client.credential_status
    finally:
        os.chmod(pem, 0o600)


def test_bad_key_config_surfaces_as_unauthorized_at_call_time(tmp_path):
    """降级的落点是"这个来源 unauthorized"，且原因要能传到界面上。"""
    client = BinanceClient("k", private_key_path=str(tmp_path / "missing.pem"))
    with pytest.raises(CredentialsMissing) as e:
        client.signed_get("https://api.binance.com", "/api/v3/account")
    assert e.value.kind == "unauthorized"
    assert "不存在" in str(e.value)


def test_broken_key_config_still_lets_portfolio_render(tmp_path, pool):
    """整条链路：配错私钥时，资产接口照常返回，私有来源记 unauthorized。"""
    from analyzer.binance.cache import SourceCache
    from analyzer.binance.portfolio import build_portfolio
    from binance_mock import NOW, make_transport

    with pool.connection() as conn:
        conn.execute("TRUNCATE binance_cache")
    client = BinanceClient("k", private_key_path=str(tmp_path / "missing.pem"),
                           client=httpx.Client(transport=make_transport()))
    try:
        snap = build_portfolio(client, SourceCache(pool), force=True, now=NOW)
    finally:
        client.close()
    states = {s["key"]: s for s in snap["sources"]}
    assert states["prices"]["status"] == "ok"          # 公开端点照常
    assert states["spot"]["status"] == "unauthorized"
    assert "不存在" in states["spot"]["detail"]


def test_lazy_signer_is_safe_under_concurrency(tmp_path):
    """六个线程同时问 signer，错误信息不能退化成笼统的那句。

    `fetch_all` 开 6 个 worker 共用一个 client。这里原先把 `_signer_loaded = True`
    写在加载**之前**：先到的线程刚置位就去读私钥，后到的看到已置位、拿到还是 None 的
    `_signer` 和还没写的 `_signer_error`，于是 `CredentialsMissing` 退化成默认文案。
    表现是整套测试间歇性红一次（约 1/3），排查方向很容易跑偏到测试间串状态上。
    """
    from concurrent.futures import ThreadPoolExecutor

    client = BinanceClient("k", private_key_path=str(tmp_path / "missing.pem"))
    try:
        with ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(lambda _: client.signer, range(6)))
        assert client.signer is None
        # 加载完成后，出错原因必须是具体的那一条
        assert client._signer_error and "不存在" in client._signer_error
    finally:
        client.close()
