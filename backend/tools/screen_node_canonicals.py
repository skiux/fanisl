"""节点 canonical 的机械筛：把最可能越界的挑出来人工看，不是自动判决。

四条筛（对应 v2 §11 的 1/2/3 号改动 + §0.6 省略式数字）：
  A 否定/推论：canonical 里的否定词在 quote 里找不到 → 可能是自己补的排除式结论
  B 转述归属：quote 带"管理层/分析师/他们说"等转述标记，或紧随其后的原文里作者明确不背书
  C 数字：canonical 里的数字在 quote 里没有 → 可能虚构，也可能是省略式补全（补对了也要核）
  D 膨胀：canonical 显著长于 quote → 加料的先验概率高
"""
import json, re, sys
import psycopg
from psycopg.rows import dict_row

conn = psycopg.connect("host=127.0.0.1 dbname=fanisl_knowledge user=enin", row_factory=dict_row)

# 只留结构上独特的对比式否定。「不能/无法/不该」这类中文同义说法太多
# （canonical 写"无法"、原文说"没有办法"），逐字比对全是误报。
NEG = re.compile(r"而不是|并不是|而非|并非")
ATTRIB = re.compile(r"管理层|高管|CEO|CFO|分析[员师]|投行|机构|他们(说|表示|认为|称)|"
                    r"公司(说|表示|认为|称)|报告(说|称|指出)|媒体|新闻")
HEDGE = re.compile(r"见仁见智|不好说|未必|我不确定|存疑|不一定|仅供参考|不代表|我保留")
NUM = re.compile(r"\d+\.?\d*")


def norm(t):
    return re.sub(r"[\s，,。.、！!？?：:；;（）()「」“”\"'’‘~—\-]", "", t or "")


rows = conn.execute("""
    SELECT n.id AS node_id, n.kind, n.title, n.canonical, n.notes,
           count(a.id) AS n_attest,
           EXISTS (SELECT 1 FROM node_relations r
                   WHERE r.a_node=n.id OR r.b_node=n.id) AS in_graph,
           json_agg(json_build_object(
             'unit_id', u.id, 'content_id', u.content_id, 'quote', u.quote,
             'creator', cr.name) ORDER BY u.id) AS units
    FROM knowledge_nodes n
    JOIN node_attestations a ON a.node_id = n.id
    JOIN knowledge_units u ON u.id = a.unit_id
    JOIN creators cr ON cr.id = u.creator_id
    WHERE n.kind IN ('concept','method')
    GROUP BY n.id
""").fetchall()

raws = {r["id"]: r["raw"] for r in conn.execute("SELECT id, raw FROM contents")}

CTX = 900   # quote 前后各取这么多字当"作者确实说过的范围"


def context_of(units):
    """quote 及其上下文——canonical 本来就该概括整段语境，只跟 quote 比会误报一片。"""
    out = []
    for u in units:
        raw = raws.get(u["content_id"], "")
        i = raw.find(u["quote"])
        if i < 0:
            out.append(u["quote"])
        else:
            out.append(raw[max(0, i - CTX): i + len(u["quote"]) + CTX])
    return " ".join(out)


flagged = []
for r in rows:
    quotes = " ".join(u["quote"] for u in r["units"])
    ctx = context_of(r["units"])
    qn, cn = norm(quotes), norm(r["canonical"])
    hits = []

    # A 筛已废弃（2026-08-14 校准）：抽 6 条全是合法转述——「而不是」是中文归纳的常用
    # 句式，node 433「这是常态而非信息」的对比本来就是原文的意思。77 条命中、精确率约 0，
    # 留着只会诱导我去"修"本来没问题的 canonical。#499/#664 那种"补了一条原文没有的排除"
    # 是语义判断，正则做不到，只能靠随机抽样兜。

    # B 转述归属 —— quote 自带转述标记，或原文紧随其后有作者的不背书
    if ATTRIB.search(quotes) and not ATTRIB.search(r["canonical"]):
        hits.append("B:quote 是转述、canonical 抹掉了归属")
    for u in r["units"]:
        raw = raws.get(u["content_id"], "")
        i = raw.find(u["quote"])
        if i >= 0 and HEDGE.search(raw[i + len(u["quote"]): i + len(u["quote"]) + 150]):
            hits.append("B:引文之后作者明确未背书")
            break

    # C 数字：要比就跟**整篇 raw**（含末尾的视觉笔记段）比。屏上表格的读数不在口播里，
    # 只跟 quote 或窗口比会把一大批合法引用误报成虚构。
    full = " ".join(raws.get(u["content_id"], "") for u in r["units"])
    cnums = {n for n in NUM.findall(r["canonical"]) if len(n) >= 2}
    orphan = {n for n in cnums if n not in full}
    if orphan:
        hits.append(f"C:数字 {sorted(orphan)[:4]} 整篇原文里都没有")

    # D 膨胀：只有在同时命中别的筛子时才有意义，单独出现噪音太大 → 降级为附注
    if hits and len(cn) > max(80, len(qn) * 1.3):
        hits.append(f"D:canonical {len(cn)} 字 vs quote {len(qn)} 字")

    if hits:
        flagged.append({**{k: r[k] for k in
                           ("node_id", "kind", "title", "canonical", "n_attest", "in_graph")},
                        "units": r["units"], "flags": hits})

# 优先级：进了关系图 > 多次提及 > 命中筛子多
flagged.sort(key=lambda x: (not x["in_graph"], -x["n_attest"], -len(x["flags"])))
print(f"concept/method 节点 {len(rows)}，命中筛子 {len(flagged)}（{len(flagged)/len(rows):.0%}）")
from collections import Counter
c = Counter(f.split(":")[0] for x in flagged for f in x["flags"])
for k in sorted(c):
    print(f"  筛 {k}: {c[k]}")
print(f"  其中进了 K6 关系图: {sum(1 for x in flagged if x['in_graph'])}")
print(f"  其中多次提及(≥2): {sum(1 for x in flagged if x['n_attest'] >= 2)}")

out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/node_review.json"
json.dump(flagged, open(out, "w"), ensure_ascii=False, indent=1)
print(f"\n→ {out}")
