"""HTTP 数据源共用的 GET helper：统一错误映射 + 可选的状态码退避重试。"""

from __future__ import annotations

import time

import httpx

from .base import DataSourceError


def get_json(
    name: str,
    url: str,
    *,
    params: dict | None = None,
    headers: dict | None = None,
    timeout: float = 20.0,
    retry_statuses: tuple[int, ...] = (),
    retries: int = 2,
    backoff: float = 13.0,
) -> dict:
    """GET 并返回 JSON；HTTP/网络错误统一抛 DataSourceError。

    retry_statuses 里的状态码（如 Polygon 免费档的 429 限速）会退避重试。
    """
    for attempt in range(retries + 1):
        try:
            resp = httpx.get(url, params=params, headers=headers, timeout=timeout)
        except httpx.HTTPError as e:
            raise DataSourceError(f"{name} 请求失败: {e}") from e
        if resp.status_code in retry_statuses and attempt < retries:
            time.sleep(backoff)
            continue
        if resp.status_code >= 400:
            raise DataSourceError(f"{name} HTTP {resp.status_code}")
        return resp.json()
    raise DataSourceError(f"{name} 重试后仍失败")
