"""L1 单元导入：JSON 文件 → pydantic 校验 + quote∈原文校验 → record_extraction 落库。

PendingBackend 工作流的入库端：Claude 会话按 extraction-guide.md 产出 JSON，本 CLI
校验后写库——与未来 ClaudeBackend 走同一校验，产出只差 extractor_version。
校验失败整文件拒绝（不半入库）。

用法：python -m analyzer.knowledge.import_units <units.json> [--dry-run]
      python -m analyzer.knowledge.import_units --runs <content_id>      # 看有哪些提取版本
      python -m analyzer.knowledge.import_units --activate <run_id>      # 换生效版本
JSON 格式见 extraction-guide.md §9。

**升版重提的语义**：新 run 落库即接管 active，同一条 content 的旧 run 转 superseded。
旧单元一条不删（版本化重放），但只有生效那版进下游统计——否则联赛表、含糊率、抽查
覆盖率会把同一期内容数两遍。发现新版不如旧版就 --activate 切回去。
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

from ..config import get_settings
from ..db import make_pool
from .models import KnowledgeUnit
from .store import KnowledgeStore


def _squash(s: str) -> str:
    return re.sub(r"\s+", "", s)


def parse_units_doc(doc: dict) -> tuple[int, str, str | None, list[KnowledgeUnit], dict[int, float]]:
    """校验并解析导入文档。返回 (content_id, version, model, units, ref_prices)。"""
    content_id = int(doc["content_id"])
    version = str(doc["extractor_version"])
    model = doc.get("model")
    units: list[KnowledgeUnit] = []
    ref_prices: dict[int, float] = {}
    for i, u in enumerate(doc["units"]):
        u = dict(u)
        rp = u.pop("ref_price", None)
        if rp is not None:
            ref_prices[i] = float(rp)
        try:
            units.append(KnowledgeUnit.model_validate(u))
        except Exception as e:
            raise ValueError(f"units[{i}] 校验失败：{e}") from e
    if not units:
        raise ValueError("units 为空")
    return content_id, version, model, units, ref_prices


def check_quotes(raw: str, units: list[KnowledgeUnit]) -> list[int]:
    """quote 必须逐字出自原文（空白归一后子串）。返回未命中的下标。"""
    hay = _squash(raw)
    return [i for i, u in enumerate(units) if _squash(u.quote) not in hay]


def _cmd_runs(store: KnowledgeStore, content_id: int) -> None:
    rows = store.runs_for_content(content_id)
    if not rows:
        print(f"content {content_id} 还没有提取记录")
        return
    print(f"content {content_id} 的提取版本：")
    for r in rows:
        mark = "→ 生效" if r["status"] == "active" else "  已取代"
        print(f"  {mark}  run {r['id']:5}  {r['extractor_version']:14} "
              f"{r['n_units']:3} 单元  {r['created_at']:%Y-%m-%d %H:%M}")


def main() -> None:
    # 版本切换：--runs <content_id> 看有哪些版本，--activate <run_id> 换生效版本。
    # 旧版单元一条不删，只是不再进下游统计——所以 v2 重提后发现不如 v1，切回去即可。
    if "--runs" in sys.argv or "--activate" in sys.argv:
        pool = make_pool(get_settings().pg_knowledge_conninfo)
        try:
            store = KnowledgeStore(pool)
            if "--runs" in sys.argv:
                _cmd_runs(store, int(sys.argv[sys.argv.index("--runs") + 1]))
            else:
                info = store.activate_run(int(sys.argv[sys.argv.index("--activate") + 1]))
                print(f"content {info['content_id']} 的生效版本 → "
                      f"{info['extractor_version']}（run {info['run_id']}）")
                _cmd_runs(store, info["content_id"])
        finally:
            pool.close()
        return

    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    dry = "--dry-run" in sys.argv
    doc = json.loads(Path(args[0]).read_text())
    content_id, version, model, units, ref_prices = parse_units_doc(doc)

    pool = make_pool(get_settings().pg_knowledge_conninfo)
    try:
        store = KnowledgeStore(pool)
        content = store.get_content(content_id)
        if content is None:
            raise SystemExit(f"content {content_id} 不存在")
        misses = check_quotes(content["raw"], units)
        if misses:
            for i in misses:
                print(f"  units[{i}] quote 不在原文中：{units[i].quote[:50]}…")
            raise SystemExit("quote 校验失败，整文件拒绝")

        kinds = Counter(u.kind for u in units)
        grades = Counter(u.payload["verifiability"] for u in units if u.kind == "claim")
        print(f"content {content_id}（{content['title'] or ''}）: {len(units)} 单元 "
              f"{dict(kinds)}  claim 分级 {dict(sorted(grades.items()))}  "
              f"ref_price {len(ref_prices)} 个")
        if dry:
            print("dry-run：校验通过，未写库")
            return
        ids = store.record_extraction(content_id, extractor_version=version, model=model,
                                      units=units, ref_prices=ref_prices)
        print(f"已入库 unit id {ids[0]}..{ids[-1]}，content 状态 → extracted")
    finally:
        pool.close()


if __name__ == "__main__":
    main()
