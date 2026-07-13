"""信源登记 CLI：python -m analyzer.knowledge.register <名称> <平台> <handle> [url]（幂等）。"""

from __future__ import annotations

import sys

from ..config import get_settings
from ..db import make_pool
from .store import KnowledgeStore


def main() -> None:
    if len(sys.argv) < 4:
        raise SystemExit("用法: register <名称> <平台> <handle> [url]")
    name, platform, handle = sys.argv[1:4]
    url = sys.argv[4] if len(sys.argv) > 4 else None
    pool = make_pool(get_settings().pg_knowledge_conninfo)
    try:
        store = KnowledgeStore(pool)
        cid = store.ensure_creator(name)
        store.ensure_handle(cid, platform, handle, url)
        print(f"已登记 creator#{cid} {name} [{platform}:{handle}]")
    finally:
        pool.close()


if __name__ == "__main__":
    main()
