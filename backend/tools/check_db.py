"""逐条验三个库的连接串，口令打码。部署时先跑它——runtime 同时开三个池，
直接起会看不出是哪个库连不上。

用法：cd backend && PYTHONPATH=src .venv/bin/python tools/check_db.py
"""

import re
import sys

import psycopg

from analyzer.config import get_settings


def main() -> int:
    s = get_settings()
    targets = (("PG_CONNINFO", s.pg_conninfo),
               ("PG_TRADING_CONNINFO", s.pg_trading_conninfo),
               ("PG_KNOWLEDGE_CONNINFO", s.pg_knowledge_conninfo))
    bad = 0
    for name, ci in targets:
        shown = re.sub(r"password=\S+", "password=***", ci) or "(空)"
        try:
            with psycopg.connect(ci, connect_timeout=5) as conn:
                db = conn.execute("SELECT current_database()").fetchone()[0]
            print(f"  ok   {name:22s} -> {db:18s} {shown}")
        except Exception as e:
            bad += 1
            print(f"  FAIL {name:22s} -> {shown}")
            print(f"       {type(e).__name__}: {str(e).splitlines()[0]}")
    if bad:
        print(f"{bad} 条连不上，先修 backend/.env")
        print("Docker 部署下三条都要写 host=127.0.0.1 与 password=（宿主机没有 Unix socket）")
    else:
        print("三条全部连通")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
