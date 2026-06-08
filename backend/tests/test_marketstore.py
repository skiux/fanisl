"""MarketStore 读写单测（PG 测试库，store 夹具做隔离）。"""

from analyzer.marketstore import GLOBAL, MarketStore, Sample


def test_samples_upsert_and_series(store):
    store.write_samples(
        [Sample("symbol", "BTC/USDT", "price", 100.0), Sample("global", GLOBAL, "fear_greed", 12.0)],
        "2026-06-07T00:00:00+00:00",
    )
    store.write_samples([Sample("symbol", "BTC/USDT", "price", 101.0)], "2026-06-07T00:15:00+00:00")
    # 同 (scope,symbol,metric,ts) 重复 → upsert 覆盖
    store.write_samples([Sample("symbol", "BTC/USDT", "price", 999.0)], "2026-06-07T00:15:00+00:00")

    series = store.get_series("BTC/USDT", ["price"])
    assert [p["value"] for p in series["price"]] == [100.0, 999.0]  # 升序，第二点被覆盖
    assert store.get_series(GLOBAL, ["fear_greed"])["fear_greed"][0]["value"] == 12.0


def test_latest_metrics(store):
    store.write_samples([Sample("symbol", "BTC/USDT", "price", 100.0)], "2026-06-07T00:00:00+00:00")
    store.write_samples([Sample("symbol", "BTC/USDT", "price", 200.0)], "2026-06-07T00:15:00+00:00")
    latest = store.latest_metrics("BTC/USDT")
    assert latest["price"]["value"] == 200.0  # 取最新 ts


def test_series_since_filter(store):
    store.write_samples([Sample("symbol", "BTC/USDT", "price", 1.0)], "2026-06-01T00:00:00+00:00")
    store.write_samples([Sample("symbol", "BTC/USDT", "price", 2.0)], "2026-06-07T00:00:00+00:00")
    out = store.get_series("BTC/USDT", ["price"], since="2026-06-05T00:00:00+00:00")
    assert [p["value"] for p in out["price"]] == [2.0]


def test_replace_catalysts_is_snapshot(store):
    store.replace_catalysts("unlock", "BTC/USDT", [{"event_date": "2026-07-01", "title": "x", "payload": {"a": 1}}])
    store.replace_catalysts("unlock", "BTC/USDT", [{"event_date": "2026-08-01", "title": "y", "payload": None}])
    cats = store.get_catalysts("BTC/USDT")
    assert len(cats) == 1  # 先删后插
    assert cats[0]["title"] == "y" and cats[0]["payload"] is None


def test_catalysts_includes_global(store):
    store.replace_catalysts("macro", GLOBAL, [{"event_date": "2026-06-10", "title": "CPI", "payload": None}])
    store.replace_catalysts("news", "BTC/USDT", [{"event_date": "2026-06-07", "title": "n", "payload": None}])
    kinds = {c["kind"] for c in store.get_catalysts("BTC/USDT")}
    assert kinds == {"macro", "news"}  # 单币查询也带上全市场(GLOBAL)


def test_write_changed_skips_unchanged(store):
    # 周期1：两个指标都写
    n = store.write_changed(
        [Sample("symbol", "BTC/USDT", "price", 100.0), Sample("global", GLOBAL, "fear_greed", 12.0)],
        "2026-06-07T00:00:00+00:00",
    )
    assert n == 2
    # 周期2：price 变了、fear_greed 没变 → 只写 price 一条
    n = store.write_changed(
        [Sample("symbol", "BTC/USDT", "price", 101.0), Sample("global", GLOBAL, "fear_greed", 12.0)],
        "2026-06-07T00:15:00+00:00",
    )
    assert n == 1
    # fear_greed 仍只有 1 个点（慢变量未重复），price 有 2 个
    assert len(store.get_series(GLOBAL, ["fear_greed"])["fear_greed"]) == 1
    assert len(store.get_series("BTC/USDT", ["price"])["price"]) == 2


def test_log_run_status(store):
    store.log_run("market", True, "5/5 ok")
    store.log_run("market", False, "fail")
    rows = store.status()
    assert len(rows) == 1 and rows[0]["job"] == "market"
    assert rows[0]["note"] == "fail"  # 最近一次


def test_log_run_prunes_to_runs_keep(pool):
    st = MarketStore(pool, runs_keep=3)
    with pool.connection() as conn:
        conn.execute("TRUNCATE collection_runs RESTART IDENTITY")
    for i in range(6):
        st.log_run("market", True, f"r{i}")
    with pool.connection() as conn:
        n = conn.execute("SELECT count(*) AS c FROM collection_runs").fetchone()["c"]
    assert n == 3  # 只保留最近 3 条
