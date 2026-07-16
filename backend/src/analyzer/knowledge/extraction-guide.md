# L1 提取规范 v1（extractor_version: pending-v1）

> 本文是提取的**冻结规范**：无论提取者是 Claude 会话（PendingBackend）还是将来的官方
> ClaudeBackend，都按本文执行。修订本文必须升 extractor_version（v1 → v2），旧版本提取
> 结果保留不删（版本化重放，见 store.py）。字段的机器校验以 `models.py` 为准（SSOT），
> 本文定义的是**判断规则**——schema 校验不了的部分。

## 0. 原则

1. **忠实高于完备**：quote 逐字摘录（≤600 字），是评分争议时的仲裁依据。宁可漏提，
   不许改写、不许把自己的理解写进 quote。import 时会机械校验 quote ∈ 原文。
2. **一条单元一个核心断言**。同一句话既有判断又有方法时拆成两条，各自引用相应片段。
3. **提取时就定评分语义**（获取与验证同体）：A/B/C 级 claim 必须当场冻结 ScoringSpec，
   不留"以后再定"。
4. **含糊也入库**：明显是对市场未来状态的表态、但被对冲到无立场 → 提取为 D 级 claim。
   D 的份额（含糊率）本身是信源指标。**不提取**的是：复盘自夸（"我们精准预判了下跌"）、
   会员导流/广告、纯寒暄、对过去的事实陈述。
5. **视觉笔记与正文平权**：屏上图表/表格的判断性标注同样可产单元，quote 引视觉笔记行，
   locator 用时间戳。

## 1. 三类单元的边界

| kind | 收什么 | 不收什么 |
|---|---|---|
| claim | 对**未来市场状态**的表态：价位/方向/相对强弱/事件结果/时点/风险警告 | 对过去的复盘；无标的的纯情绪 |
| method | **可复述的操作规则**：进出场、级别选择、仓位、过滤器——"怎么做"的知识 | 一次性的当下操作描述（那是 claim 的证据） |
| concept | **可复用的认知**：框架（存量/增量逻辑）、经验规律（"中期选举年 6-10 月波动高"）、量化事实带出处（"高盛估算芯片涨价对核心 PCE 影响 0.35%"）、原则（"不择时"） | 常识（"分散降低风险"这类无信息量的） |

判断/方法/认知三类平权——concept 不是二等品，它是最耐久的沉淀（定位修订 2026-07-16）。

**情景推演 vs 观点**：创作者排练两侧（"涨也正常跌也正常"）——若对某一侧表达了倾向
（"我认为更可能…""我们不能在这里看空"）→ 提取为 claim，方向取倾向侧；纯对称排练无倾向
→ 提取为 D 级 claim（stance_strength=hedged，direction=null）。
**带条件的判断**（"站住 4288 则挑战 4440"）→ C 级 claim：condition_text 抄原文条件，
condition_observable 按"条件能否用日线数据机械判定"填（价位条件=true，"若情绪好转"=false；
false 则整条只能 D）。

## 2. Claim 的可验证性分级（判据）

- **A**：标的明确 + 期限原文自带（明确日期/事件）+ 语义机械可判 + 可定价。
  例："维持标普 500 年底 8200 点预期不变" → target_close, deadline=当年-12-31。
- **B**：标的与方向/目标明确，但期限是模糊词 → 用 §3 映射表定期限（期限系我方阶梯，
  success_def 里注明）。可定价。
- **C**：带机械可判的前置条件（condition_observable=true）；或标的需我方指定代理
  （"科技股"→QQQ，在 asset_symbol 填代理并在 success_def 注明）。
- **D**：无立场对冲 / 标的不可定价且无合理代理 / 条件不可机械判定 / 期限无法套映射表。
  D 不带 scoring_spec（models.py 强制）。

**方向词的判读**：「争夺/震荡/多空协商」= range 或 D；「不能看空」「不要意外」这类
双重否定按上下文取倾向，拿不准降 D。宁降不拔高。
**stance_strength 记立场承诺度，不是语气词**：「大概率 X」这类**单侧概率承诺** = explicit
（立场明确，只是概率化）；hedged 留给双向可解释（"涨也正常跌也正常"）；speculative =
明标猜测（"赌一把""拍脑袋"）。

## 3. 期限映射表（冻结；B 级的"我方阶梯"）

原文期限词 → Horizon（自发布日起算，自然日；评分取 deadline 当日或此前最近交易日收盘）：

| 原文 | horizon |
|---|---|
| 日内 / 今天 / 明天 | within_duration 2 |
| 这两天 / 本周 / 短线 / 短期 | within_duration 7 |
| 未来几周 / 短中期 | within_duration 21 |
| 中期 / 中线 / 一两个月 | within_duration 60 |
| 季度内 / 未来几个月 | within_duration 90 |
| 下半年 / 年底 / 今年 | by_date 当年-12-31 |
| 明年 / 长期 | within_duration 365 |
| **无期限词** | open_ended；eval_ladder = 发布日 +7 / +30 / +90 天 |

原文自带明确日期/事件（"11 月中期选举落地"）→ by_date 用原文，级别照 §2 判 A。
eval_ladder 一律写成 ISO 日期列表（提取时从 published_at 算好），open_ended 在
success_def 注明"阶梯系我方指定"。

## 4. ScoringSpec 模板（按 claim 形态选 method）

| 形态 | method | 约定 |
|---|---|---|
| 纯方向（涨/跌） | sign | 到期收盘 vs ref_price 符号一致=hit |
| 触及目标价（"挑战 4440"） | target_touch | 期限内任一日 high/low 触及=hit；不触及=miss |
| 到期收在目标（"年底 8200"） | target_close | 到期收盘±2% 内=hit；方向对但差 2-5%=partial |
| 区间维持（"4000-4200 是支撑"） | range_hold | 期限内日收盘不破下沿=hit；盘中破收回=partial |
| 相对强弱（"存储强于大盘"） | relative_return | benchmark 填基准符号，期限收益差>0=hit |

success_def 必须一句话写清成败判据（含模糊处的裁定，如"支撑成立指收盘不破 4000"）。
magnitude 的键约定：target（目标价）/ low, high（区间）/ pct（百分比）。

## 5. ref_price（发布时刻参考价）

优先级：**① 视觉笔记屏上最新价**（该资产在笔记里有标价时直接用——最贴近创作者说话时点，
且覆盖我方未采集资产）→ **② pit.asof**（我方行情库有该资产时，K4 接线）→ **③ 空缺**
（unit 上不填，评分器遇缺按 unpriceable 处理）。单元 JSON 里放顶层 `ref_price` 字段。
**屏价必须与正文互证**：转录的视觉笔记数值偶发失真（实测 content#1 多个屏价是旧年份水平，
与正文口述价位矛盾）。屏价与正文明显矛盾（量级不符/与口述关键位冲突）时**不填**，宁缺毋滥——
空缺可由 K4 回填发布日收盘，错值会污染整条评分。

## 6. asset_symbol 与 priceable

- 规范符号：指数 NDX/SPX/DJI/KOSPI；ETF/个股用交易所 ticker（SOXX/IGV/MAGS/NVDA/MU）；
  金属 XAUUSD/XAGUSD；油 WTI；加密 BTCUSDT 等（与 instruments 一致时用 instruments 名）。
- priceable=true 的范围：美股/ETF/主要指数/金银油/主流加密/KOSPI——K4 将配日线源
  （yfinance/Stooq 级别）。冷门标的或"某板块"无代理时 priceable=false（→ 最高 D）。

## 7. 标签（可检索性的入口）

每单元 1-5 个，全小写：
- **资产标签** = 规范符号小写（xauusd, ndx, spx, soxx, igv, mags, kospi, nvda, wti, btc…）；
- **主题标签** = kebab-case 英文受控词，起始集：fed-policy, inflation, oil-supply,
  ai-capex, semiconductor-cycle, memory-storage, software, mag7, midterm-election,
  consumer, macro-data, price-action, ema-tunnel, fibonacci, market-breadth,
  rotation, risk-mgmt, position-sizing。
- 新主题词可加，但先查本表避免同义分裂；新增词回填进本表（本文件即受控词表）。

## 8. Method / Concept 填写要点

- Method：rules 尽量保留原始表述（数字、级别、条件原样）；claimed_performance 记录
  不采信；overlap_with_killed 对照 H1-H22（防重杀尸体，见 doc/research/）；
  testability：A=现有/易得数据可回测，B=缺数据，C=规则本身不可机械化。
- Concept：canonical_statement 用一句归一化中文（后续归并的抓手，措辞稳定重于文采）；
  经验规律/量化事实归 category=macro_framework（宏观类）或 market_structure（市场类），
  带出处的量化事实把出处写进 canonical_statement（"高盛估算…"）。

## 9. 输出格式（import_units CLI 的输入）

一个内容一个 JSON 文件：

```json
{
  "content_id": 7,
  "extractor_version": "pending-v1",
  "model": "claude-session",
  "units": [
    {
      "kind": "claim",
      "quote": "逐字原文…",
      "locator": "06:29",
      "ref_price": 4238.9,
      "tags": ["xauusd", "price-action"],
      "payload": {
        "asset_text": "黄金", "asset_symbol": "XAUUSD", "priceable": true,
        "claim_class": "price_target", "direction": "up",
        "magnitude": {"target": 4440},
        "horizon": {"type": "within_duration", "duration_days": 7},
        "condition_text": "站住 4288", "condition_observable": true,
        "stance_strength": "explicit", "verifiability": "C",
        "scoring_spec": {
          "method": "target_touch",
          "eval_ladder": ["2026-06-22"],
          "success_def": "条件：先有日收盘≥4288；成立后 7 个自然日内任一日最高价触及 4440 = hit"
        }
      }
    }
  ]
}
```

导入：`python -m analyzer.knowledge.import_units <file.json> [--dry-run]`。
校验失败整文件拒绝（不半入库）；quote 不在原文中（空白归一后）即拒。

## 10. 质检（spot_checks）

每批提取后随机抽 20%（首批全查）人工核三点：quote 忠实、无漏提大项、spec 判据合理。
verdict 写入 spot_checks 表。规范本身的问题 → 改本文 + 升版本号重提，不打补丁。
