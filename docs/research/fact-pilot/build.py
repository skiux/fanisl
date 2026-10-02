"""校验三期事实层并生成查看页。

quote 必须逐字在转录稿里（空白归一后），frame 必须在截图目录里，不过就不生成。转录稿从知识库只读取出，
所以要在 backend 目录、带隧道运行。截图不进仓库：FRAMES 下按 video_id 分目录放精简前的全集，
页面里内嵌缩到 1280 宽的副本。

    cd backend && PYTHONPATH=. .venv/bin/python ../docs/research/fact-pilot/build.py FRAMES [输出路径]
"""
import base64
import html
import importlib
import pathlib
import re
import subprocess
import sys
from collections import Counter

from fanisl.config import get_settings
from fanisl.db import make_pool

HERE = pathlib.Path(__file__).parent
EPISODES = ("talk_1500", "talk_1501", "talk_1502")
STATUS_CLASS = {"一致": "ok", "大致一致": "near", "部分核对": "near", "不一致": "bad", "无法核对": "na"}
norm = lambda s: re.sub(r"\s+", "", s)
esc = lambda s: html.escape(str(s))

sys.path.insert(0, str(HERE))
eps = [importlib.import_module(m).EPISODE for m in EPISODES]
frames_root = pathlib.Path(sys.argv[1])
out = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else HERE / "out" / "talk-facts.html")

pool = make_pool(get_settings().pg_knowledge_conninfo, min_size=1, max_size=1)
with pool.connection() as c:
    raws = {r["id"]: norm(r["raw"]) for r in c.execute(
        "SELECT id, raw FROM contents WHERE id = ANY(%s)", ([e["content_id"] for e in eps],))}
pool.close()

frame_list = lambda f: [] if not f.get("frame") else [f["frame"]] if isinstance(f["frame"], str) else f["frame"]
problems, used = [], {}
for e in eps:
    vid = e["url"].split("v=")[1]
    for g in e["groups"]:
        for f in g["facts"]:
            where = f"{e['episode']} {f['id']}"
            if f.get("quote") and norm(f["quote"]) not in raws[e["content_id"]]:
                problems.append(f"{where} quote 不在原文：{f['quote'][:30]}")
            if f["check"]["status"] not in STATUS_CLASS:
                problems.append(f"{where} 未知核对状态 {f['check']['status']}")
            for name in frame_list(f):
                path = frames_root / vid / name
                if not path.exists():
                    problems.append(f"{where} 截图不存在：{path}")
                used[f"{vid}/{name}"] = path
if problems:
    sys.exit("\n".join(problems))


def shrink(path):
    jpg = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vf", "scale='min(1280,iw)':-2",
                          "-q:v", "5", "-f", "mjpeg", "pipe:1"], capture_output=True, check=True).stdout
    return "data:image/jpeg;base64," + base64.b64encode(jpg).decode()


def mmss(name):
    s = int(name[:5])
    return s, f"{s // 60:02d}:{s % 60:02d}"


def table(t):
    head = "".join(f"<th>{esc(c)}</th>" for c in t["columns"])
    rows = "".join("<tr>" + "".join(f"<td>{esc(v)}</td>" for v in r) + "</tr>" for r in t["rows"])
    return f'<div class="tbl"><table><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table></div>'


def fact(e, f):
    vid = e["url"].split("v=")[1]
    st = f["check"]["status"]
    parts = [f'<article class="fact"><div class="fh"><span class="fid">{f["id"]}</span>'
             f'<h4>{esc(f["title"])}</h4><span class="st {STATUS_CLASS[st]}">{esc(st)}</span></div>']
    if f.get("detail"):
        parts.append(f'<p>{esc(f["detail"])}</p>')
    if f.get("table"):
        parts.append(table(f["table"]))
    if f.get("quote"):
        parts.append(f'<blockquote>{esc(f["quote"])}</blockquote>')
    meta = []
    if f.get("origin"):
        meta.append(f'<span><b>来源</b>{esc(f["origin"])}</span>')
    if f["check"].get("detail"):
        meta.append(f'<span><b>核对</b>{esc(f["check"]["detail"])}</span>')
    if f.get("note"):
        meta.append(f'<span><b>注</b>{esc(f["note"])}</span>')
    if meta:
        parts.append(f'<p class="meta">{"".join(meta)}</p>')
    for name in frame_list(f):
        s, t = mmss(name)
        parts.append(f'<details class="shot"><summary>截图 {t}'
                     f'<a href="{esc(e["url"])}&t={s}s" target="_blank" rel="noopener">原片</a></summary>'
                     f'<img alt="{t}" data-k="{vid}/{name}"></details>')
    return "".join(parts) + "</article>"


def episode(e):
    facts = [f for g in e["groups"] for f in g["facts"]]
    n = Counter(f["check"]["status"] for f in facts)
    counts = "".join(f'<span class="st {STATUS_CLASS[k]}">{k} {n[k]}</span>' for k in STATUS_CLASS if n[k])
    fr = e["frames"]
    lost = "；".join(fr["lost_by_filter"]) or "无"
    head = (f'<header class="eh"><h2><a href="{esc(e["url"])}" target="_blank" rel="noopener">{esc(e["title"])}</a></h2>'
            f'<p>发布 {e["published"]} · 数据截至 {esc(e["as_of"])} · 事实 {len(facts)} 条</p>'
            f'<p class="counts">{counts}</p>'
            f'<p class="frames">截图 {fr["total"]} 张，含数据 {fr["with_data"]} 张。精简误删：{esc(lost)}'
            + (f'。{esc(fr["note"])}' if fr.get("note") else "") + "</p></header>")
    body = "".join(f'<h3>{esc(g["title"])}</h3>' + "".join(fact(e, f) for f in g["facts"]) for g in e["groups"])
    return f'<section class="ep" id="ep{e["episode"]}">{head}{body}</section>'


tabs = "".join(f'<button data-ep="{e["episode"]}">{e["episode"]} 期 · {e["published"][5:]}</button>' for e in eps)
imgs = "{" + ",".join(f'"{k}":"{shrink(p)}"' for k, p in used.items()) + "}"
page = ((HERE / "template.html").read_text()
        .replace("__TABS__", tabs)
        .replace("__BODY__", "".join(episode(e) for e in eps))
        .replace("__IMGS__", imgs))
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(page)
for e in eps:
    facts = [f for g in e["groups"] for f in g["facts"]]
    print(e["episode"], len(facts), "条", dict(Counter(f["check"]["status"] for f in facts)),
          "表", sum(1 for f in facts if f.get("table")), "原话", sum(1 for f in facts if f.get("quote")))
print("截图", len(used), "张；写出", out, f"{out.stat().st_size / 1e6:.1f} MB")
