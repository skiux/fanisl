# 数据改动同步清单（加/改一个 metric 要动哪里）

重构后 metric 名有了**单一事实来源** `backend/src/analyzer/metrics.py`（登记表）。大部分下游
（工具描述、前端目录、一致性）会自动同步。下面按场景列出**仍需手动改的地方**。
忘了同步 → `tests/test_metrics.py` 会直接报错。

## 守护机制
- `metrics.py` = 所有 metric 名 + 元信息（category/unit/scope/label/ts_meaning）的 SSOT。
- `indicators/compute.py: indicator_series()` = 逐周期入库指标"算什么"的单一定义（回填 + 快照共用）。
- `tests/test_metrics.py` 断言：flatten/backfill 落库的名字 ⊆ 登记表；`indicator_series` 的 key == `TF_BASES`。

## 场景 1：加一个**逐周期技术指标**（如某新震荡指标 _1d/_4h…）
1. `metrics.TF_METRICS`：加一行 `TfMetric(base, 标签, 单位, from_view=lambda v: ...)`。
2. `indicators/compute.indicator_series`：加 `"base": <整条 Series>`。
3.（可选）要在快照里展示：`models` + `snapshot/builder` 加字段，`from_view` 指向它。
→ flatten、backfill、工具 metric 词汇、前端目录**自动同步**。

## 场景 2：加一个**标量指标**（衍生品/盘口/链上/情绪等，单值）
1. 数据源 `data/*`：加 `fetch_*`；`models` + `snapshot/builder`：算出该值。
2. `flatten.py`：加一行 `add("metric_name", ...)`（前向落库）。
3. `metrics.SCALAR_METRICS`：加一行 `MetricDef("metric_name", 类别, 单位, scope, 标签, ts_meaning)`。
4.（可回填则）数据源加 `fetch_*_history` + `backfill.py` 挂上对应回填。
→ 工具词汇、前端目录自动同步；忘了第 3 步 → 测试报错。

## 场景 3：加一个**宏观序列**（FRED）
1. `data/fred_source.FRED_SERIES`：加 `(series_id, metric_name, units)`（units: lin/pc1/chg）。
2. `metrics._MACRO_LABELS`（+ 特殊单位进 `_MACRO_UNITS`）：加标签。
→ 回填、目录、工具词汇自动同步。

## 场景 4：改名 / 删除
- 改 `metrics.py` 登记表 + 对应 flatten/compute/源。跑测试，它会指出还没同步的地方。
- 清 DB 旧数据**按 metric 名删**：`DELETE FROM metric_samples WHERE metric='旧名'`。
  **切勿用 ctid**——metric_samples 是 TimescaleDB hypertable，ctid 跨 chunk 不唯一会误删。

## `ts_meaning` 取值（加 metric 时按数据性质选）
`candle`(K线周期) | `sample`(采样时刻) | `settlement`(结算) | `day`(所属日)
| `reference_period`(数据参考期，非发布时刻，宏观用) | `event`(事件发生时刻)。
含义详见 [data-inventory.md](data-inventory.md) 的「ts 字段语义」。

## 前端取数（场景 3 的"为前端准备"）
- `GET /metrics/catalog` → 全量 metric 目录（登记表，含 unit/label/scope/ts_meaning），前端据此枚举。
- `GET /metrics/available?symbol=X` → 该标的实际有数据的 metric + 覆盖（样本数/起止/最新值）。
- `GET /metrics?symbol=X&names=a,b` → 多指标时间序列。
