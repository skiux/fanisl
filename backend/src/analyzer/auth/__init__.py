"""登录与用户管理。实现说明与运维步骤见同目录 README.md。"""

from .passwords import hash_password, needs_rehash, verify_password
from .routes import build_router, current_user
from .session import AuthMiddleware, client_ip, is_public
from .store import ROLES, UserExists, UserStore, normalize_username

__all__ = [
    "AuthMiddleware", "ROLES", "UserExists", "UserStore",
    "build_router", "client_ip", "current_user", "hash_password",
    "is_public", "needs_rehash", "normalize_username", "verify_password",
]
