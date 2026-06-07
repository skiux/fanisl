"""MarketStore 读写单测（临时 SQLite 文件，不联网）。"""

from analyzer.marketstore import GLOBAL, MarketStore, Sample


def _store(tmp_path) -> MarketStore:
    return MarketStore(str(tmp_path / "t.db"))


def test_samples_upsert_and_series(tmp_path):
    st = _store(tmp_path)
    st.write_samples(
        [Sample("symbol", "BTC/USDT", "price", 100.0), Sample("global", GLOBAL, "fear_greed", 12.0)],
        "2026-06-07T00:00:00+00:00",
    )
    st.write_samples([Sample("symbol", "BTC/USDT", "price", 101.0)], "2026-06-07T00:15:00+00:00")
    # 同 (scope,symbol,metric,ts) 重复 → upsert 覆盖
    st.write_samples([Sample("symbol", "BTC/USDT", "price", 999.0)], "2026-06-07T00:15:00+00:00")

    series = st.get_series("BTC/USDT", ["price"])
    assert [p["value"] for p in series["price"]] == [100.0, 999.0]  # 升序，第二点被覆盖
    assert st.get_series(GLOBAL, ["fear_greed"])["fear_greed"][0]["value"] == 12.0


def test_latest_metrics(tmp_path):
    st = _store(tmp_path)
    st.write_samples([Sample("symbol", "BTC/USDT", "price", 100.0)], "2026-06-07T00:00:00+00:00")
    st.write_samples([Sample("symbol", "BTC/USDT", "price", 200.0)], "2026-06-07T00:15:00+00:00")
    latest = st.latest_metrics("BTC/USDT")
    assert latest["price"]["value"] == 200.0  # 取最新 ts


def test_series_since_filter(tmp_path):
    st = _store(tmp_path)
    st.write_samples([Sample("symbol", "BTC/USDT", "price", 1.0)], "2026-06-01T00:00:00+00:00")
    st.write_samples([Sample("symbol", "BTC/USDT", "price", 2.0)], "2026-06-07T00:00:00+00:00")
    out = st.get_series("BTC/USDT", ["price"], since="2026-06-05T00:00:00+00:00")
    assert [p["value"] for p in out["price"]] == [2.0]


def test_replace_catalysts_is_snapshot(tmp_path):
    st = _store(tmp_path)
    st.replace_catalysts("unlock", "BTC/USDT", [{"event_date": "2026-07-01", "title": "x", "payload": {"a": 1}}])
    st.replace_catalysts("unlock", "BTC/USDT", [{"event_date": "2026-08-01", "title": "y", "payload": None}])
    cats = st.get_catalysts("BTC/USDT")
    assert len(cats) == 1  # 先删后插
    assert cats[0]["title"] == "y" and cats[0]["payload"] is None


def test_catalysts_includes_global(tmp_path):
    st = _store(tmp_path)
    st.replace_catalysts("macro", GLOBAL, [{"event_date": "2026-06-10", "title": "CPI", "payload": None}])
    st.replace_catalysts("news", "BTC/USDT", [{"event_date": "2026-06-07", "title": "n", "payload": None}])
    kinds = {c["kind"] for c in st.get_catalysts("BTC/USDT")}
    assert kinds == {"macro", "news"}  # 单币查询也带上全市场(GLOBAL)


def test_log_run_status(tmp_path):
    st = _store(tmp_path)
    st.log_run("market", True, "5/5 ok")
    st.log_run("market", False, "fail")
    rows = st.status()
    assert len(rows) == 1 and rows[0]["job"] == "market"
    assert rows[0]["note"] == "fail"  # 最近一次
