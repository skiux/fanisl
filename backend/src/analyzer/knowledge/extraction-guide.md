# L1 提取规范 v2（extractor_version: pending-v2）

> 本文是提取的**冻结规范**：无论提取者是 Claude 会话（PendingBackend）还是将来的官方
> ClaudeBackend，都按本文执行。修订本文必须升 extractor_version（v2 → v3），旧版本提取
> 结果保留不删（版本化重放，见 store.py）。字段的机器校验以 `models.py` 为准（SSOT），
> 本文定义的是**判断规则**——schema 校验不了的部分。
>
> **v2（2026-08-14）**：v1 语料 798 条单元全量质检后收口，改动见 §11。v1 的产出仍以
> `pending-v1` 留在库里，不删不改；重提产生 `pending-v2` 的新 run（`extraction_runs` 上
> `(content_id, extractor_version)` 唯一，两版并存可对照）。

## 0. 原则

1. **忠实高于完备**：quote 逐字摘录（≤600 字），是评分争议时的仲裁依据。宁可漏提，
   不许改写、不许把自己的理解写进 quote。import 时会机械校验 quote ∈ 原文。
   quote 之外的自由文本字段（canonical_statement / success_def / summary / rules / notes）
   **同样受这条约束**——机械校验管不到它们，v1 的三类越界都出在这里（v2 新增）：
   - **不得添加原文没有的推论或否定**。v1 #499 原文只正面给了判据（"防守板块同时下跌
     才是 risk on"），canonical 自行补了"齐涨只是普涨"；#664 canonical 加了原文没有的
     "而不是估值高低或叙事热度"。补出来的对不对不是重点——它没被作者说过。
   - **不得把第三方的说法记成作者主张**。v1 #434 把 PLTR 管理层的话写成作者的 concept，
     而原文紧接着是"是不是真的做不到，我想见仁见智"——作者明确未背书。转述他人观点时：
     作者背书了才提取为作者的 concept；未背书则要么不提，要么在 canonical 里写明归属
     （"PLTR 管理层称…；作者未置可否"）。
   - **success_def 的理由不得超出原文**。v1 #223 写"他同时定了涨超 450 即平仓认错的纪律"，
     但原文无"认错"，"涨超即平仓"是他讲另一笔 QQQ 交易和海鸥通则时说的，被移植了过来。
     判据可以是我方机械化的，**理由必须能在原文里指得出来**。
2. **一条单元一个核心断言**。同一句话既有判断又有方法时拆成两条，各自引用相应片段。
3. **提取时就定评分语义**（获取与验证同体）：A/B/C 级 claim 必须当场冻结 ScoringSpec，
   不留"以后再定"。
4. **含糊也入库**：明显是对市场未来状态的表态、但被对冲到无立场 → 提取为 D 级 claim。
   D 的份额（含糊率）本身是信源指标。**不提取**的是：复盘自夸（"我们精准预判了下跌"）、
   会员导流/广告、纯寒暄、对过去的事实陈述。
5. **视觉笔记与正文平权**：屏上图表/表格的判断性标注同样可产单元，quote 引视觉笔记行，
   locator 用时间戳。**但时间戳本身不可尽信**（v2 补注）：长视频上模型会编时间戳——
   实测 c2 片长 25:57、笔记却标到 53:37，unit #15（标普 8200 那条 A 级）的 locator 45:12
   指向不存在的时刻。提帧（`backfill_keyframes`）会机械滤掉超出片长的时点，抓不到帧的
   时间戳即存疑；locator 只作导航用，**任何判断都以 quote 为准，不以时间戳为准**。
6. **口语省略的数字按语境补全**（v2 新增）：
   作者报完整数字后，相邻位置常只说尾数——Andy c5「纳指100…在 30400 点、300 点」
   和「市场在 30400 点、600 点」，说的是 30300 和 30600，不是 300/600。补全规则：
   缺的高位数从同句/上文最近的完整数字里取，且补全后必须落在该标的当时的真实价位量级
   （黄金 4 字头就该是 4xxx，纳指 3 万点就该是 30xxx）。
   - **quote 仍逐字引原文**（"600点" 照抄，import 的机械校验才过），补全只写进
     magnitude / success_def，并在 success_def 里注明"原文省略式，按上文 30400 补全"；
   - 补不出唯一解（上下文没有可依据的完整数字）就不要猜——降级或不提该条；
   - 反向陷阱：3 位数不一定都是省略。个股价位（MSFT 435、NVDA 200、SOXX 564）、
     EMA 周期（144/169）、指数名（标普 500、纳指 100）本来就是那么多位，别乱加前缀。
   - 入库后可用「magnitude 与该 symbol 实际价位区间比对」体检，差一个数量级的即可疑。

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

**非价格判断不得机械化成价格 claim**（v2 新增）：「基本面越来越好」「我持有」「暂时不减仓」
是**立场**，不是对未来价位的表态。v1 把它们编成了 +7/+30/+90 的价格方向 claim——#727
（英特尔）尤其突兀：原文紧接着就写"无非就是它的一个价格，短期真的会和便宜的问题"，作者
明确回避短期价格，提取却给了他一条 7 天价格判断。判别问句：**作者有没有说价格会怎样？**
没有就归 concept（认知）或 method（操作规则），或 D 级 claim；只有作者自己把立场和价位
挂上钩（"跌到 X 我加仓""涨到 Y 我减"）才可以出 A/B/C。

**方向词的判读**：「争夺/震荡/多空协商」= range 或 D；「不能看空」「不要意外」这类
双重否定按上下文取倾向，拿不准降 D。宁降不拔高。
**"维持/保持在低位（高位）"不是 sign，是 range_hold 或 flat**（v2 新增）：sign/down 要求
到期严格低于起点＝**要求再创新低**，比原文严厉。v1 #637 就栽在这里：作者说"VIX 在低位
可以持续一段时间""8 月稍微平静一些"，而当时 14.6 按他自己的话已是 1 月以来新低，编成
sign/down 等于要它刷新该低点。判别：作者说的是**变化**（涨/跌）还是**维持**（守住/仍在）。
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

**本表是冻结的，open_ended 的三级阶梯不接受裁量**（v2 收紧）：v1 有 6 条自行改了阶梯——
#59/#61 只留 +90，#80/#126/#154 只留 +30/+90，#239 用了 +90/+365，每条都在 success_def
里写了理由。理由再合理也不行：阶梯长度直接决定这条 claim 在联赛表里贡献几个观测，逐条
裁量等于让提取者调节自己的分母。**无期限词就是 +7/+30/+90 三级，一个不少。**
唯一例外：原文自带时间尺度时按原文，且必须是作者说的（v1 #397 取 180 天，依据是他自己
统计的"大跌后持有半年"口径——这类合规）。

**同一句原文派生的多条 claim，期限口径必须一致**（v2 新增）：v1 #454 与 #455 出自同一句
「黄金可以长期布局，比特币也进入了一个加仓区间」，黄金按"长期"取 365 天、比特币按
"下半年展望"取年底——同一句话两套读法。同句多标的时先定这句话的时间尺度，再套给每个标的。

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
magnitude 里放非价格量（估值倍数、EPS、增速）时**必须在 asset_text 写明它是什么**——
v1 #477 装的是 forward PE 24-25 倍而不是 SOX 点位，靠 asset_text"芯片板块（SOX 指数）的
forward PE"才看得出来。否则事后无法与真实价位比对，省略式数字的体检也会误报。

**阶梯函数标的用严格不等号**（v2 新增）：政策利率（FRED DFEDTARU）这类读数在两次变动之间
完全不动，而 sign/up 的标准语义是 `收盘 >= 参考价`——"没加息"会被判成 hit。v1 #670 就这么
从 miss 变成了 hit，联赛表跟着错。凡标的是阶梯/离散序列且判断是"会变动"，success_def 要
写明严格大于/小于，并在 `scoring_overrides.json` 配 `{"mode":"close_at_eval","op":">"}`。
（连续价格序列不受影响——等于起点的概率为零。）

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
  rotation, risk-mgmt, position-sizing；2026-08 新增（投资TALK君语料带入）：
  valuation, balance-sheet, capital-raise, labor-market, bond-yields, fiscal-policy,
  fx-intervention, ipo-supply, ai-agent, stablecoin, power-demand, neocloud,
  datacenter-financing, compute-pricing, gpu-depreciation, defensive-sector, oversold；
  2026-08-14 质检回填（已在用但漏登记）：psychology, positioning, market-structure,
  execution, moat。
- 新主题词可加，但先查本表避免同义分裂；新增词回填进本表（本文件即受控词表）。
- **已发生的同义分裂（勿再用左侧）**：`semi` → 用 `semiconductor-cycle`；`dram` →
  用 `memory-storage`。资产标签只写规范符号本身（soxx/sox/smh/semi 是四个不同标的，
  按 claim 实际映射的 asset_symbol 写，不可互替）。

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
  "extractor_version": "pending-v2",
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

**v1 的教训：抽查欠账会把规范问题拖成语料问题。** v1 全程只抽查了 36/798 = 4.5%，远低于
本节要求的 20%，而 §11 那七条里有六条是一次 24 条的抽查就翻出来的——欠的不是工作量，
是发现问题的时机。v2 起按批次结清：一批提取完成即抽满 20%，没抽完不开下一批。

## 11. v1 → v2 改动清单（2026-08-14）

来源：v1 语料（49 期内容 / 798 条单元）的全量机械体检 + 24 条分层抽查。
括号内是触发该条的 v1 单元号，重提时按新规则处理。

| # | 改动 | 位置 | v1 实例 |
|---|---|---|---|
| 1 | 自由文本字段不得添加原文没有的推论/否定 | §0.1 | #499 #664 |
| 2 | 不得把第三方说法记成作者主张 | §0.1 | #434 |
| 3 | success_def 的理由必须在原文里指得出 | §0.1 | #223 |
| 4 | 口语省略数字按语境补全（quote 仍照抄） | §0.6 | c5 纳指 30300/30600 漏提 |
| 5 | locator 时间戳可能为模型虚构，判断只认 quote | §0.5 | #15（c2 片长 25:57、标到 53:37）|
| 6 | 非价格判断（看好/持有/不减仓）不得编成价格 claim | §2 | #727 #614 |
| 7 | "维持在低位/高位"用 range_hold/flat，不用 sign | §2 | #637 |
| 8 | open_ended 阶梯 +7/+30/+90 冻结，不接受裁量 | §3 | #59 #61 #80 #126 #154 #239 |
| 9 | 同句原文派生的多条 claim 期限口径须一致 | §3 | #454 vs #455 |
| 10 | 阶梯函数标的（政策利率）用严格不等号 | §4 | #670（曾误判 hit）|
| 11 | magnitude 放非价格量须在 asset_text 写明 | §4 | #477（装的是 forward PE）|
| 12 | 标签受控词回填 + 同义分裂登记 | §7 | semi/dram，psychology 等 5 词漏登记 |

**不在本次改动范围**（体检已确认无问题，记录以免重复排查）：quote 逐字校验 798/798 全过；
A/B/C 必带 spec、D 必不带，全库零违反；期限映射除上述 6 条外全部自洽；行情覆盖 55 个符号
零缺口；magnitude 与真实价位的量级比对零误值。
