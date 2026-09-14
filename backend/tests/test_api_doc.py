"""backend/api.md 是接口契约，必须跟着路由表走。

头部写着端点总数（"= **N 个**"），正文里每条路由的路径都要出现。只核路径、不核方法：
文档里有表格、有 "GET … · DELETE …" 合写的标题，逐条配方法不值当；总数对得上、路径都在，
"加了路由没写文档"与"数字漂移"两件事就都挡住了。路径参数名不比（文档里写的是 {id}）。
"""

import pathlib
import re

from fastapi.routing import APIRoute

API_MD = pathlib.Path(__file__).resolve().parents[1] / "api.md"


def _api_routes() -> list[APIRoute]:
    """递归摊平：include_router 进来的子路由不在 app.routes 顶层（见 test_auth._walk_routes）。"""
    from fanisl.main import app

    def walk(routes):
        for route in routes:
            if isinstance(route, APIRoute):
                yield route
            inner = getattr(route, "original_router", None) or getattr(route, "router", None)
            if inner is not None and hasattr(inner, "routes"):
                yield from walk(inner.routes)

    return list(walk(app.routes))


def _shape(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "{}", path)


def test_header_total_matches_the_route_table():
    header = API_MD.read_text().split("\n## ", 1)[0]
    totals = re.findall(r"\*\*(\d+) 个\*\*", header)
    assert totals, "api.md 头部找不到「**N 个**」端点总数"
    routes = _api_routes()
    assert len(routes) > 70, "路由表没装上？"
    assert int(totals[-1]) == len(routes), (
        f"api.md 头部写 {totals[-1]} 个端点，路由表实际 {len(routes)} 条——加了路由就要更新契约")


def test_every_route_path_is_documented():
    doc = _shape(API_MD.read_text())
    missing = sorted({route.path for route in _api_routes()
                      if not re.search(re.escape(_shape(route.path)) + r"(?=[?\s`|)·,：（]|$)",
                                       doc, re.M)})
    assert not missing, f"api.md 里没有这些路由：{missing}"
