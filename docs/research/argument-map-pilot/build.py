"""校验三份样板并生成查看页。

quote 与 link 必须逐字在原文里（空白归一后），from / method 引用的节点必须存在。原文与 claim
评分从知识库只读取出，所以要在 backend 目录、带隧道运行：

    cd backend && PYTHONPATH=. .venv/bin/python ../docs/research/argument-map-pilot/build.py [输出路径]
"""
import importlib.util
import json
import pathlib
import re
import sys

from fanisl.config import get_settings
from fanisl.db import make_pool

HERE = pathlib.Path(__file__).parent
CONTENTS = (127, 126, 123)
norm = lambda s: re.sub(r"\s+", "", s)

pool = make_pool(get_settings().pg_knowledge_conninfo, min_size=1, max_size=1)
with pool.connection() as c:
    raws = {r["id"]: norm(r["raw"]) for r in c.execute("SELECT id, raw FROM contents WHERE id = ANY(%s)", (list(CONTENTS),))}
    scores = {r["id"]: {"grade": r["g"], "scores": r["sc"]} for r in c.execute("""
        SELECT u.id, u.payload->>'verifiability' g,
               coalesce(json_agg(json_build_array(s.horizon_label, s.outcome) ORDER BY s.horizon_label)
                        FILTER (WHERE s.id IS NOT NULL), '[]') sc
        FROM knowledge_units u LEFT JOIN claim_scores s ON s.unit_id = u.id
        WHERE u.content_id = ANY(%s) AND u.kind = 'claim' GROUP BY 1, 2""", (list(CONTENTS),))}
pool.close()

maps, problems = [], []
for cid in CONTENTS:
    spec = importlib.util.spec_from_file_location(f"m{cid}", HERE / f"map_c{cid}.py")
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    m, raw = mod.MAP, raws[cid]
    ids = {n["id"] for k in ("facts", "reasoning", "conclusions", "methods") for n in m[k]}
    for k in ("facts", "reasoning", "conclusions", "methods"):
        for n in m[k]:
            for f in ("quote", "link"):
                if n.get(f) and norm(n[f]) not in raw:
                    problems.append(f"c{cid} {n['id']} {f} 不在原文：{n[f][:30]}")
            for src in n.get("from", []) + ([n["method"]] if n.get("method") else []):
                if src not in ids:
                    problems.append(f"c{cid} {n['id']} 引用了不存在的 {src}")
    for n in m["conclusions"]:
        n["claims"] = [{"unit": u, **scores[u]} for u in n["units"] if u in scores]
    for mm in m["methods"]:
        mm["used_by"] = [n["id"] for k in ("reasoning", "conclusions") for n in m[k] if n.get("method") == mm["id"]]
    maps.append(m)

if problems:
    sys.exit("\n".join(problems))
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "argument-map-pilot.html")
data = json.dumps(maps, ensure_ascii=False).replace("</", "<\\/")
out.write_text((HERE / "template.html").read_text().replace("__DATA__", data))
for m in maps:
    print(m["creator"], {k: len(m[k]) for k in ("facts", "reasoning", "conclusions", "methods")})
print("写出", out)
