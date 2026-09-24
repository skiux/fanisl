# Binance 只读层（资产台后端）

给 `console/`（资产台）供数的三组只读接口：`/portfolio`、`/orders`、`/ledger`，以及只写
本地数据库的管理员股票成本接口 `/admin/stock-costs/{symbol}` 与现货成本接口
`/admin/spot-costs/{asset}`。形状由
`console/src/api/types.ts` 定义，那份契约**按 Binance 原始字段写**，不是想当然的余额模型。

全员共用同一个 Binance 账户，凭据在服务器 `.env`，权限只开 Enable Reading。

## 两类“股票”不是同一个产品

Binance 2026 的文档里同时存在两条股票相关路径，接口与账户语义不同：

- **Stocks Trading** 走 `/sapi/v1/equity/*`，代码是 `AAPL` 这类裸 ticker，委托默认以
  USDC 计价，并带 `RTH` / `EXTENDED` / `24H` 交易时段。它有挂单、委托历史和逐笔成交，
  但当前 Account 文档只有签署免责声明的写接口，**没有独立股票持仓查询端点**（官方
  REST 文档 2026-09-19 复核）。
  **持仓在钱包明细里**：买入的正股在资金钱包记作 `EQ_` 开头的资产（SOXL → `EQ_SOXL`），
  文档没写，2026-09-17 线上实测。`/portfolio` 据此给出 `stocks.equity_holdings`：
  数量取钱包余额，市值用明细里的 `btcValuation` 换算（为 0 或缺失时留 `null`）。
  不从成交历史反推持仓——转入、转出与公司行动会让倒推的数量静默失真。
  Binance 当前不给完整持仓成本与手续费，资产页不再用不完整历史反推。管理员为当前
  持仓录入单位平均成本价与手续费，总成本 = 单价 × 当前股数 + 手续费；保存时记录当前股数，钱包股数
  变化后旧值标为 `stale`，平均成本与盈亏保持 `null`，直到重新录入。最新买卖价来自
  `/equity/market/quote`，交易方向、常规/延长时段碎股与隔夜能力来自 `exchangeInfo`。
  委托与成交历史仍供 `/orders` 展示，不参与 `/portfolio` 的成本计算。
  **逐日盈亏仍不含正股**：`held_across_wallets` 不读资金钱包，股票也没有 REST 日线
  （只有 WebSocket K 线）。
- **现货币仓成本**同样由管理员为当前持仓填写单位平均成本价与手续费，保存到独立于 Binance
  响应缓存的 `binance_spot_costs` 表。`GET /portfolio` 的 `spot_costs` 按币种返回录入值与
  保存时的数量；console 在现货钱包、合约钱包和全仓杠杆合并后核对数量，匹配才显示
  平均成本和这笔持仓的盈亏（现货只是拿着，不叫未实现）。旧版整仓价值记录没有明确单价，不自动换算为新成本；
  数量变化或余额来源失败时不沿用旧成本；稳定币在现金
  模块，不录入成本。理财持仓仍在自己的模块，不计入这笔币仓的录入数量。
- **TradFi Perps** 仍是 USDⓈ-M Futures，走 `/fapi/*`，代码如 `NVDAUSDT`。它继续使用
  合约保证金、强平价与 ADL 逻辑；`exchangeInfo` 的 `underlyingType` / `underlyingSubType`
  用来识别 TradFi，`tradingSchedule` 给出当前市场时段，`symbolAdlRisk` 给出标的级 ADL
  风险。

钱包详情中的 `AAPLB` 之类代币化资产是第三种形态。它们通过
`/sapi/v1/equity/market/tokenized-assets` 映射回 `AAPL`，作为可验证的股票敞口进入持仓；
不与独立 Stocks Trading 的未知持仓混为一谈。

## 账户模式先探测，再取风险数据

`/portfolio` 先读 `/sapi/v1/account/info` 与 `/sapi/v1/account/apiRestrictions`。账户没有
开通的产品不再盲调端点：来源状态记为 `unsupported`，前端显示为「未启用」，不计入
「数据缺失」。这一步也把账户产品能力与 API key 的读/交易权限分开；二者不是同一件事。

杠杆能力启用时才取三组只读数据：

- `/sapi/v1/margin/account`：全仓杠杆账户；
- `/sapi/v1/margin/isolated/account`：逐仓交易对、风险率、指数价与强平价；
- `/sapi/v1/margin/liquidation-loan`：强平破产后的账户缺口。`remainingAmount > 0` 才在
  页面显示告警；它不是「可借额度」，也不是普通负债。**没有借款时回 200 + 空响应体**
  （文档没写），落成 `liquidation_loan: null`，来源状态照常是 ok。

统一账户能力启用后，先用 `/sapi/v1/portfolio/account` 读 `accountType`。`PM_1` / `PM_2`
继续通过 `papi.binance.com` 的 `/papi/v1/account`、`/papi/v2/um/account` 与
`/papi/v1/um/positionRisk` 读取账户和 U 本位仓位；`PM_3`（SPAN）改走
`/sapi/v2/portfolio/account` 与 `/sapi/v1/portfolio/balance`。契约保留原始
`account_type`，避免把 Binance 文档里变动过的产品名称写死。整个客户端仍只有 GET；
不会调用免责声明签署、还款、下单或其他写接口。

Stocks Trading 的订单流已经有 WebSocket，但当前服务只有请求级缓存，没有可续播的事件
存储与断线补洞机制。订单与资产页继续 REST 轮询；在持久化事件游标和补偿查询完成之前，
把 WebSocket 接进来只会让断线期间的状态静默缺失。

## Key 类型

Binance 支持三种，并推荐 **Ed25519**；HMAC 当前仍受支持。三种都支持，
按配置自动判型（`signing.py`），换类型只改 `.env`。启动时打印 `[fanisl] binance key 类型=…`。

| 类型 | 配置 | 签名 |
|---|---|---|
| Ed25519（推荐） | `BINANCE_PRIVATE_KEY_PATH` | PureEdDSA → base64 |
| RSA | 同上 | PKCS#1 v1.5 + SHA-256 → base64 |
| HMAC | `BINANCE_API_SECRET` | HMAC-SHA256 → hex |

非对称的好处对这个场景是实的：**私钥不出服务器**，Binance 只存公钥，所以交易所侧
即使出事也伪造不了你的请求。对只读 key 而言泄露的后果本来就有限，但成本也只是多跑一条
`openssl genpkey`。

两处写错就恒 401：
- **编码不同**：HMAC 出 hex，非对称出 base64。
- **base64 必须再 percent-encode**：签名里有 `+` `/` `=`，`+` 不编码会被服务端解成空格。
  代码里**无条件编码**（hex 编不编都一样）——少一个分支，也不会出现"只在某种 key 类型下
  才复现"的 bug。

```
signing.py    key 类型判定（HMAC / Ed25519 / RSA），按 .env 自动选
client.py     签名 + 错误分类 + 对时                 ← 不含任何写入方法
cache.py      按来源的 TTL 缓存 + 降级语义
routes.py     管理员录入持仓单位成本价与手续费（只写本地表，不调用 Binance 写接口）
common.py     字符串数值解析、计价、钱包名映射
costbasis.py  交易对拆分 + **跨钱包持有量**（成本基础引擎已删，见文件头）
dailypnl.py   **逐日盈亏**：进出清单 → 历史持仓量 → 每天赚了多少   ← 口径核心
portfolio.py  /portfolio  资产快照（含股票、TradFi、杠杆与统一账户风险）
orders.py     /orders     委托（现货 / 杠杆 / U 本位 / Stocks Trading）
ledger.py     /ledger     流水（8 个端点，20 次调用）
```

**改盈亏口径之前先读 `dailypnl.py` 的模块注释**，那里写着为什么不能用资产差额法、
每天的持仓量怎么回滚出来、以及每一类进出为什么按那个单位成本折算。

## 为什么不用 ccxt（项目里已经装着）

它的统一模型会把这三页要的字段抹掉：现货四种锁定态（free/locked/freeze/withdrawing）、
ADL 排队分位、条件单的 `workingType`/`closePosition`、`leverageBracket` 的维持保证金档位、
日快照、理财持仓、小额兑换、闪兑。绕一层统一模型再拆回来只会丢字段，而签名本身是 40 行 HMAC。

`client.py` 里**没有任何下单、划转、提现方法**——不是忘了写。这个进程持有的 key 只该有
读权限，代码里也不该存在写入路径；将来有人想加，得先解释为什么。

## 三条不肯让步的口径

**取不到就是 `null`，不拿 `0` 顶替。** `0` 是一个有效余额。`common.dec()` 解析失败返回
`None` 而不是 `0`，需要"缺失即 0"的场合显式用 `dec0()`。

**日线按 UTC 日切。** 逐日盈亏拿 `klines(symbol, "1d")` 的收盘价，日期取 `openTime`
所在的 UTC 日——与 `income` 分桶、与界面日历的每一格都是同一条边界。
日快照（`accountSnapshot`）已经不用了，理由见下。

## 按来源降级

每个端点单独取、单独缓存、单独记状态。用户网络里的 451 是**间歇的、而且常常只打在
fapi 上**，现货那半边不该跟着一起坏。

| 情况 | 返回 | 前端表现 |
|---|---|---|
| 新鲜 | 数据 + `status=ok` + 取数时刻 | 正常 |
| 过期但取到了 | 新数据 | 正常 |
| 过期且失败 | **旧数据** + 真实失败原因 + **旧时刻** | 蒙上 `.veiled`，标红原因 |
| 从未成功 | `null` | 留空，不是 0 |

**取数抛出任何异常都只降级那一个来源。** `cache.fetch` 原先只接 `BinanceError`：
2026-09-17 强平借款接口回了 200 + 空响应体，`resp.json()` 抛的 `JSONDecodeError` 穿出
`fetch_all`，整个资产页 500。现在客户端把"200 但不是 JSON"报成 `unreachable`
（上游异常），`fetch` 对其余意料之外的异常同样记 `unreachable` 并打到 stderr。

**装配失败也按来源降级。** 字段解析在缓存层外面——Binance 改一次字段类型（数组元素从
对象变字符串这类），整页就会 500。所以每一块装配都过 `common.guard()`：失败时这一块变
`null`、该来源记 `unsupported`、原因进 `detail` 显示在「取数状态」里，同时打到 stderr
（journalctl 可查）。**不静默吞掉，也不带走别的来源。**

错误分成五类（对齐契约的 `SourceStatus`）。分类是给人看的：`unauthorized` 说明去查 key
权限与 IP 白名单，`unreachable` 说明等网络或换出口——两者处置完全不同，不该混成一句"失败"。
时钟漂移（`-1021`）是唯一自动重试的错误，重新对时后重试一次；其余重试只会浪费权重预算。

## 缓存不是优化，是必需

IP 权重上限 **6000/分钟**。而：

| | 权重 | 说明 |
|---|---|---|
| `accountSnapshot` | 2400 × 3 | 三种类型就是 7200，已经超一分钟预算 |
| `withdraw/history` | 18000 | 账户维度限速 10 次/秒 |
| `convert/tradeFlow` | 3000 | |
| 流水页全量 | **21345**，20 次调用 | 这个数会显示在界面上 |

所以界面上的"重新取数"（`force=true`）**不穿透**日快照、杠杆档位、提现历史、闪兑——
连点几下就能把预算打空，然后**所有**页面一起 429，而这几样本来就是日频/极少变的数据。
并发数固定在 6：权重按 IP 算，几十个并发只会更快撞上 429。

`/portfolio`、`/orders`、`/ledger` 共用同一批缓存键（`prices`、`spot`、`futures.risk`，
`/portfolio` 与 `/orders` 还共用 `income`），先开哪一页，另外两页就少几次调用。

## 页面时刻（`as_of`）只看"会变的"那些来源

`as_of` 是**会变的来源里最旧的一个**。取最旧是因为报最新会让整页显得比实际新鲜；
只算 live 那一组（`LIVE_CADENCE`）是因为 `brackets`（24 小时）与 `snapshots`（6 小时）
是**有意长缓存的日频数据**，把它们算进去，整页会被标成"已过期"，界面上还挂一句
"下面全部数字来自 X 的快照，不是当前余额"——而余额其实是 60 秒内的，那句话是假的。

它们各自的真实年龄没有被藏起来：每个来源的 `as_of` 照常返回，界面上的「取数状态」
一格一格地显示。

## 读文档才知道的坑（都有测试盯着）

| 坑 | 后果 |
|---|---|
| `/fapi/v3/account` **没有**标记价、强平价、ADL 分位 | 在 `positionRisk` 与 `adlQuantile` 上。少了它们"距强平多远"无从算起 |
| v3 的 `account` 持仓行也**没有** `entryPrice` / `leverage` / `isolated`，v3 `positionRisk` 只补回了 `entryPrice` | 杠杆倍数与全仓/逐仓只在 `/fapi/v1/symbolConfig`。迁到 v3 后照 v2 字段读，线上每个仓位都成了开仓价 0、1×、全仓（2026-09-17 核对线上缓存） |
| Stocks Trading 的 Account 文档没有持仓 GET | 持仓只能从钱包明细认：正股是资金钱包里的 `EQ_<代码>`（文档没写，2026-09-17 实测），代币化股票按 tokenized-assets 映射；不能用成交净额伪造持仓 |
| 股票逐笔成交没有手续费，`order/history` 在线上又可能漏掉 `fee` 或对应成交 | `/orders` 原样保留可得历史；`/portfolio` 不拿残缺记录估算成本，由管理员录入单位平均成本价与手续费，股数变化后停用旧值 |
| BFUSD 已移到 Simple Earn，账户余额接口不带当前年化 | 用 `/sapi/v1/bfusd/history/rateHistory` 的最近一条 `annualPercentageRate`，并应用到各钱包中的 BFUSD 现金行 |
| 活期理财的年化是**阶梯**的，`latestAnnualPercentageRate` 只是超出阶梯之后的实时利率 | 用同一行里的 `tierAnnualPercentageRate`（形如 `{"0-500USDT": 0.12}`）按当前金额加权：档内那部分按档位利率，其余按实时利率（`_apr_tiers`）。实时利率未知而又有超出部分时报 `null`，不给半个数 |
| Stocks Trading 行情要求 API key 但不要求签名 | 当公开端点调用会 401；当 USER_DATA 调用会多余地签名 |
| TradFi Perps 仍属于 USDⓈ-M | 不能按裸股票账户处理；保证金、强平与资金费仍走 fapi |
| 账户能力与 API key 权限是两层 | `isMarginEnabled=true` 不表示只读 key 有交易权限；展示和请求分流不能混用 |
| `PM_1` / `PM_2` / `PM_3` 需要先探测 | 前两类走 PAPI，`PM_3` 的 SPAN 汇总走 SAPI v2；不能对所有账户打一套端点 |
| liquidation loan 是强平后的破产缺口 | 不是可用余额乘杠杆，也不是借款额度；只有 `remainingAmount` 是仍待处理的风险 |
| TP/SL/追踪止损已迁到 `/fapi/v1/openAlgoOrders` | 只查普通 `openOrders` 会漏掉账户已有的保护单 |
| TradFi 股息调整记为 `SPECIAL_FUNDING_FEE` | 它属于资金费；归到 other 或丢弃都会把损益算错 |
| 合约要读 `origType` 而不是 `type` | 条件单触发后 `type` 变 MARKET，止盈单会显示成"市价单" |
| 现货 `STOP_LOSS` 是止损**市价**，`STOP_LOSS_LIMIT` 才是限价 | 两个名字很容易读反 |
| `orderListId = -1` 表示不属于任何 OCO 组 | 照搬会变成一个假的组号 |
| 市价单的 `price` 是 `"0"` | 那不是"价格为零" |
| 提现的 `applyTime` 是**字符串** `"2026-08-25 10:00:00"` | 当毫秒解析得到 1970 年，整段提现排到时间线最底下 |
| 杠杆利息字段官方拼错成 `interestAccuredTime`（少个 c） | 照正确拼写取不到 |
| 闪兑返回 `list`、小额兑换返回 `userAssetDribblets`、其余是 `rows` | 三种壳 |
| `income` 里的 `TRANSFER` 不是损益 | 混进去净值仍对得上、盈亏全错 |
| 策略单端点在 **sapi** 上，不在 fapi | fapi 451 时它照常可取——不是矛盾，是两个域名 |
| `marginLevel` 无负债时返回 999 哨兵 | 照搬会显示成荒谬的风险率 |
| `leverageBracket.notionalCoef` 只在账户档位被单独调整时出现 | 档位上下界与 `cum` 都要同倍缩放，否则压力测试跨错档 |

## 现金只有一份名单（`common.STABLE_ASSETS`）

"哪些资产算现金"原先在四个地方各写了一份：`common._USD_PEGGED`（7 个）、
`costbasis.USD_QUOTES`（7 个）、前端 `format.STABLE_ASSETS`（6 个）、
示例数据（4 个）。**四份还不一样**，而它被用在四种互不相干的判断上。

现在只有 `common.STABLE_ASSETS` 一处，`USD_QUOTES` 从它派生（那个回答的是另一个问题：
symbol 的右半边可能是什么），并随快照发给前端（`stable_assets`）。

少一个的后果按用途分两种：

- **计价**：稳定币没有自己的 USDT 对，不特判就成了"无报价"，账户里最大的一块
  反而算不进净值。
- **算不算持仓**：它若有 USDT 对（PYUSDUSDT 之类）就会被 `_cost_symbols` 拉日线，
  于是 ±0.03% 的报价噪声进了 `daily_spot_pnl`——一万美元的仓位每天凭空 ±$3。

名单里有两类比 `USD_QUOTES` 多出来的东西，都是这个账户真会碰到的：**别的美元稳定币**
（PYUSD / USD1 / USDD / USDE），以及**理财与合约的 1:1 包装**（`LDUSDT` 是活期理财里的
USDT，`BFUSD` 是能当合约保证金的稳定币）。后者尤其要紧：它们没有自己的交易对，
漏掉就同时是"无报价"和"被当成一笔币仓"。

**欧元稳定币（EURI / AEUR）故意不在里面。** 是稳定币但不是美元，按 1 美元计价直接
算错；让它们走正常报价、算成一笔汇率敞口才对。

## 盈亏怎么算（`dailypnl.py` + `portfolio.py:_pnl`）

**这一节是整个模块最容易搞错的地方，2026-09 连着修了四轮，每一轮的错都在下面。
改这块之前先读完。**

### 为什么不能用"期末 − 期初 − 净充提"

最自然的想法是拿净值差额倒推：这段时间涨了多少、减掉自己充进来的钱，剩下的就是赚的。
**在 Binance 上这条路走不通**，原因是硬的：

- `accountSnapshot` 只有 `SPOT` / `MARGIN` / `FUTURES` 三种类型。理财、资金、币本位、
  期权**没有历史快照**。拿它当期初、拿全部钱包当期末，两边量的不是同一批钱，
  差额里混着理财本金。
- 就算两边都只算那三个钱包，**钱包之间的划转仍然会被算成盈亏**：从现货转 10000 USDT
  进理财，三钱包合计少 10000，而那不是充提（`capital/deposit` 里没有它），
  于是显示成亏了 10000。
- 更糟的是把"未实现变动"做成残差反解：`未实现 = 真实盈亏 − 已实现 − 资金费 − 手续费`。
  这样瀑布图**永远闭合**，任何口径错误都被残差照单全收，错了看不出来。
  上面两个 bug 就是这么藏了很久的。

所以 `equity_curve` 与 `attribution` 两个字段**已经删除**，日快照那四个来源
（`snapshots.spot/margin/futures/btc`）也一并去掉了。别再加回来。

### 现在的口径

```
daily[]                 **每天到底赚了多少**，见 dailypnl.py：
                          spot_usd    现货持仓当天的涨跌（含当天成交那部分）
                          settled_usd 合约当天结算掉的（已实现+资金费+手续费+返佣）
                          pnl_usd     两者之和；算不出来时是 null
today.*                 daily 最后一格，同一个数只算一处
today.settled_parts     当天结算按类型拆开（`_today_settled`）。**复用 `_income`
                        换一个窗口**，不另写一套分类——两套分类迟早对不上。
                        各项之和 == settled_usd；income 取不到时是 null
unrealized.futures_usd  positionRisk 的 unRealizedProfit（交易所给的标记价）
realized.futures_usd    income 的 REALIZED_PNL
carry.*                 资金费 / 手续费 / 返佣
spot_marks[]            逐币今日涨跌，给详情抽屉用
unbalanced_assets[]     持仓量回滚不平的币（有一类进出没覆盖到）
```

**`pnl.unrealized` 与 `pnl.realized` 里都只有合约。** 现货在持仓页另行显示管理员
录入的当前币仓成本及相对成本的未实现盈亏，不并入日历与汇总。自动推导历史成本不可靠，
理由见下面第 ① 条。响应里也没有 `spot_assets` / `coverage` / `incomplete_assets` /
`failed_symbols`——它们随成本基础引擎一起删了。

划转不是成交，动不了任何一个币的数量与成本，所以这条路对划转完全免疫；
逐日盈亏按跨钱包持有量算，同样不受划转影响。

### 四个修过的坑（每一条都有测试钉着）

**① 不应凭成交历史自动计算现货"未实现"。** 它是市值减加权平均成本，而那个成本要**完整的买入
历史**。这个账户拿不到：划转 / 理财派息 / 小额兑换 / 闪兑进来的币从不出现在
`myTrades` 里，`capital/deposit/hisrec` 又只回 90 天，更早的充值永远查不回来。

为它修过三轮，一轮比一轮更像那么回事，但没有一轮解决问题：

1. 拿 `cost_usd / 重放数量` 的均价去乘**余额的全部数量**——等于假设没见过买入记录
   的币和见过的同价。实测重放 1 个 BNB @ $650、实际持有 6.712 个，未实现算成
   +$215.79，有据可依的只有 +$32.15。
2. 只对 `min(余额, 重放数量)` 算，多出来的报在 `unpriced_qty`。不虚高了，
   但报出去的仍是一个永远缺一块的数。
3. 早期试过手填均价，仍把这段未经核对的历史记录混进汇总。现在仅对管理员明确录入
   的**当前币仓**单独显示成本和未实现盈亏，不拿它反算历史已实现或覆盖账户汇总。

**已实现是同一个病，只是更隐蔽。** 它 `= Σ 卖出量 × (卖出价 − 当时均价)`，用的是
同一个均价。卖得比重放看到的还多时能被识破（那个币会标成成本不明、整个剔除），
可**买得比看到的多、卖得不多时无声出错**——报一个看不出错的数比不报更糟。
所以最后 `Lot` / `replay` / `summarize` 整套删掉，`costbasis.py` 只剩
`split_symbol` 与 `held_across_wallets`。

**现货要回答的是"每天涨跌了多少"，那只需要当天的持仓量与当天的收盘价，
不需要任何成本。** 见 `dailypnl.py`：

    盈亏_d = q_d × close_d − q_{d−1} × close_{d−1} − 进出_d

`进出_d` 按每笔的**单位成本**折算，这一项决定同一笔数量变化算不算收益：
成交按成交价（买入当天只赚"成交价到收盘"那一段）、充提与合约结算按当日收盘
（本身不产生盈亏）、理财派息按 0（白得的，全额算收益）。

日线取 `klines(symbol, "1d", limit=WINDOW_DAYS+2)`：最后一根是今天这根、还在走，
它的 close 就是现价；多取两根是因为算窗口第一天要用它前一天的收盘。

合约那半边不受影响：`unRealizedProfit` 与 `REALIZED_PNL` 都是交易所按自己的
开仓均价算好给的，拿来即用——所以 `pnl.unrealized` 与 `pnl.realized` 里**只有合约**。

**② `income` 的金额单位是该行的 `asset`，不一定是 USDT。** 手续费常用 BNB 抵扣
（`asset: "BNB", income: "-0.012"`）。不看 asset 直接相加等于把 0.012 个 BNB
当成 0.012 美元，手续费凭空少几十倍。已按币种换算，换不出价的单独计数不当 0 吞。

**③ 划进合约 / 杠杆 / 理财的币要算进持有量。** `/fapi/v3/account` 的 `assets` 数组、
`/sapi/v1/margin/account` 的 `userAssets` 原先整段没读。持有量按"账户一共有多少"
算，不认钱包，否则划走的部分会显示成卖掉了。合约那边用 `walletBalance` 而不是
`marginBalance`——后者含浮盈，那是仓位的钱不是多出来的币。

**资金钱包也在里面**（2026-09-22 补）。它原先整个不在 `held_across_wallets` 里，
放在那儿的币逐日盈亏一分都不算——而这个账户的正股、一部分 USDT 与小币就在资金钱包。
数量取自 `wallet/balance?needBalanceDetail=true` 的逐资产明细。

**"现货数据取不到"多半就是这一条**：币划进了合约钱包当保证金，量一直都在，
只是当初只读了现货余额。逐日盈亏与已实现都走 `held_across_wallets`；
资产页把它们按币种并入「现货持仓」（行内不再标是哪个钱包，见 console/README.md）；
稳定币仍归入「现金」，避免把保证金重复画成一笔投资持仓。

**④ 稳定币是计价单位，不是有成本的持仓。** USDT 的成本恒等于面值。当成普通仓位记，
会因为"没见过它怎么进来的"被标成成本不明，进而把账户里最大的一块从已实现里剔掉。

### 每天的持仓量从哪来

没有"历史余额"这个接口，只能**从今天的余额往回滚**：`q_{d−1} = q_d − 当天净进出`。

关键在于持仓量按**跨全部钱包**统计（`held_across_wallets`），于是钱包之间的划转
自动抵消——从现货挪进合约、存进理财都不改变总量，根本不用去查划转记录。
真正会改变总量的只有这几类，`_flow_jobs` 逐个取：

| 来源 | 端点 | 单位成本 |
|---|---|---|
| 现货成交 | `myTrades`（已有，全历史） | 成交价 |
| 充提 | `capital/deposit,withdraw`（已有，90 天） | 当日收盘 |
| 合约结算 | `fapi/v1/income`（已有，90 天） | 当日收盘（损益已计在 settled 里） |
| 理财派息 | `simple-earn/*/history/rewardsRecord`（`type=ALL`） | 当日收盘（**另行成项**） |
| 杠杆利息 | `margin/interestHistory` | 当日收盘（**另行成项**） |
| 闪兑 | `convert/tradeFlow`（**只回 30 天**） | 当日收盘 |
| 小额兑换 | `asset/dribblet`（**只回 30 天**） | 当日收盘 |
| 正股成交 | `equity/trade/history` | 成交价 |

**派息与利息不在盯市里，各自成项**（`dailypnl.daily_credits`）。原先它们的单位成本是
0，等于把损益并进那个币当天的涨跌里；而**稳定币整个不参与盯市**，于是 USDT 活期的
派息与杠杆利息在「今日盈亏」里一分都看不到——那恰恰是这个账户上金额最大的一块理财。
现在它们按 1 美元折算（其余资产按当日收盘），在接口里是 `today.earn_usd` /
`today.interest_usd`，日历每一格也各有一份。

**活期派息要问 `type=ALL`。** 活期的收益分实时年化（`REALTIME`）与阶梯年化奖励
（`BONUS`）两类，另有历史奖励（`REWARDS`）。这里原先只问 `REWARDS`，阶梯那部分
从来没被取到。

**回滚出负数 = 有一类进出没被覆盖到**（这个账户上最可能是 90 天以外的充值）。
那天报 `null` 而不是一个错的数，`unbalanced_assets` 把是哪几个币说出来。
夹到 0 只会把误差往前推。

**没有报价对的币整个不参与**（`unpriced_assets`），与净值同一个口径。曾经写成
"任一持有的币缺价 ⇒ 那天报空"，结果一个几分钱的尘埃仓位（0.00071 PAXG，
没有 USDT 对）把整张 90 天日历抹成了空白。

### 正股那一份：唯一一处非 Binance 数据

**Binance 的股票接口没有日线，也没有前收。** `equity/market/quote` 只给买一卖一
（binance-sdk-stocks 1.2.0 复核，2026-09-22），另外十五个端点都是下单与查单。
而"今天涨跌了多少"必须有昨收，所以正股的日线取自仓库里已有的 Yahoo 源
（`data/yahoo_source.py`，免 key，复权收盘），接口里用 `pnl.equity_close_source`
标明出处。持仓数量仍来自钱包明细（`EQ_` 开头的资产），与「股票持仓」同一份。

正股**另走一遍同一套盯市**（`daily_spot_pnl`，只是换一份行情），不与加密那一遍
合并：两边的降级不该互相牵连。Binance 行情挂了，不该让股票那一行顶上去冒充"今天赚了
多少"；Yahoo 挂了，也不该把整张日历抹空——那种情况下正股按 0 计，
`pnl.equity_missing` 把没算进去的代码点名，界面上照样写出来。

股票**周末与假日没有行情**，而盯市是逐个 UTC 日走的：缺一根就会把那天判成"算不出来"。
所以取到的日线按日历向后补齐（`_equity_closes`）——周六的市值本来就等于周五的收盘，
当天涨跌是 0，这不是近似。

### 窗口不一样，别加成一个数

| | 窗口 | 为什么 |
|---|---|---|
| `daily[]` / `today` | 90 天 | 与 `income` 对齐；日线本可更久，但另一半只有 90 天 |
| 合约已实现 / 资金费 / 手续费 / 返佣 | 90 天 | `income` 接口只保留 90 天 |
| 合约未实现 | 此刻 | `positionRisk` 是当前值，没有窗口概念 |

界面上的「合约收支」之所以能画对比条、能求和，正是因为它四行**同源同窗口**
（全部来自 `income`）。旧版把 1 天（今日涨跌）、此刻（未实现）、全历史（现货已实现）、
90 天混在一张表里画条，`+$3,847`(90 天) 旁边摆着 `+$127`(今天)，比出来的东西
没有意义——那张表已经拆掉。

### 覆盖不全是硬限，要说出来

`myTrades` 的 `symbol` 必填，而 Binance **没有"我交易过哪些对"的接口**。候选是从
当前持有的币 × USDT 推的，所以**已经清仓的币查不到**。

这条限制现在只影响**逐日盈亏的回滚**（那个币的进出看不见），而不再影响任何一个
"已实现"的数——那套东西已经删了。回滚不平的币报在 `unbalanced_assets` 里，
受影响的天 `pnl_usd` 是 `null`。

## 流水页的两条硬边界

**没有统一的流水接口**，时间线由八个端点合并，每条记录带 `source`。

**单次能查 30 天**，等于各来源上限的交集，卡在理财派息 / 杠杆利息 / 闪兑。这不是设计选的
数字，是接口给的，所以 `windows` 表原样返回给前端显示。

划转（`/sapi/v1/asset/transfer`）的 `type` 必填，官方枚举约 40 种。这里只问**这个账户可能
用到的 12 种**——全问一遍是 40 次调用，其中大半（期权、币本位各种组合）恒为空。少问的代价
写在 `fanout` 字段里，界面上看得到。12 次里只要有一次没问到，`wallet_transfers` 就报
不完整，不能说"正常"。

## 委托页的硬边界

**当前挂单能一次拿全账户**（`openOrders` 的 symbol 可省，现货 weight 80 / 合约 40）；
**历史要按交易对问**：现货 `allOrders`/`myTrades` 与合约 `userTrades` 仍需 symbol；
股票委托与成交不需要 symbol，一次拿全账户。

**合约 `allOrders` 的 symbol 自 2026-08-25（官方 SDK 17.2.1）起可省，但这里不用那个
全账户查询。** 上一版「全部」就是靠它按小于 7 天切窗覆盖 90 天，2026-09-17 线上的表现是：
「全部」里只剩一笔股票委托、合约委托一条没有，切换 7/30/90 天委托历史纹丝不动（成交明细
会变，它一直是逐个交易对问的）；而选定任一合约交易对都查得到。那次请求是报错还是返回空
没有留下记录，原因未查明。现在「全部」与「选定一个」走同一条路：候选里的每个交易对逐个问，
共用同一批缓存键，同一个交易对在两处看到的不会不一样。

而 Binance **没有"我交易过哪些对"的接口**，只能推一份候选（`_history_candidates`）：
挂单、持仓、**近 90 天合约收支**、**股票委托与成交**、现货余额能配出的交易对。
合约收支里每笔成交都有 COMMISSION，平掉的仓位靠它找回；股票代码来自股票历史本身，
不再只在碰巧出现在本次结果里时才进候选（原先选了别的交易对，SOXL 就从下拉框里消失）。
做不到真正的全量——从没成交过、也不在持仓与挂单里的交易对查不到，这一点界面上也说明白。
每个候选带着 venue 返回（`history_venues`），前端据此把股票单独分组。

股票历史**一次取全账户，选定一只在本地筛**。原先选定时带 symbol 去问，却与「全部」共用
`orders.history:equity` 一个缓存键，5 分钟内两种查询会拿到对方的结果。

**"必须逐个问"不等于"只问一个"。** 不带 `symbol` 时把候选里的每个都问一遍再合并，
`query.symbol` 报 `null`、`query.symbols` 列出问过哪几个。上一版是 `symbol or symbols[0]`
——谁都没选的时候按字母序挑了一个，于是这一节永远在讲某个标的，而字段名叫 `history`。

三条随之而来的规矩：

- **窗口取交集**：现货单次 24 小时 / 无回溯上限，合约 168 小时 / 90 天。合起来报
  24 小时 + 90 天，报最宽的等于替另一半打包票。
- **状态整组算**（`_merge_states`）：任何一个交易对没取到，`order_history` /
  `trade_history` 就不是 `ok`。合并出来的历史少一截，界面上分不出是"那个交易对没有
  记录"还是"那次没取到"。取到的那部分照常给——451 常常只打 fapi，现货那半边还在。
  「全部」时合约收支也算在组里：它没取到，候选可能缺了已平仓的交易对。
- **成本是 2N 个请求**（N = 候选数）。可接受的理由：候选由持仓、余额与近 90 天收支界定（不是全市场），
  每个按 `TTL["history"]` 各自缓存，而现货成交那一半 `/portfolio` 本来就在按同样的
  粒度取。真要更省，下一步是把 `orders.trades:spot:{sym}` 与 `/portfolio` 的
  `trades.{sym}` 并成同一个缓存键——两边调的是同一个端点。

`_fill` 顺带给出 `commission_usd`：`commission` 的单位是 `commissionAsset`，现货常用
BNB 抵扣、合约结在 USDT。**合并之后必然跨币种**，不换算就是 `_income` 那个坑的翻版
（把 0.0008 个 BNB 当成 0.0008 美元）。

## 接口清单与限额

三个 base 各有**各自独立**的权重池，互不相干：

| base | 域名 | 权重上限 | 计量 |
|---|---|---|---|
| SPOT / SAPI | `api.binance.com` | **6000 / 分钟** | 按 IP（`X-MBX-USED-WEIGHT-1M`） |
| USDⓈ-M | `fapi.binance.com` | **2400 / 分钟** | 按 IP（`X-MBX-USED-WEIGHT-1M`） |
| 公开行情 | `api.binance.com` | 与 SPOT 同池 | 不签名，但照样计权重 |

两个上限现取自 `GET /api/v3/exchangeInfo` 与 `GET /fapi/v1/exchangeInfo` 的
`rateLimits`（2026-09-02 核）——这是权威来源，文档正文里反而没写死。

少数 SAPI 端点是**按账户 UID** 而不是按 IP 限速（下表标出）。响应头每次都读进
`client.last_weight`。超限返回 **429**；收到 429 后不退避会被自动封 IP（**418**），
封禁时长按累犯递增，**2 分钟到 3 天**。

下表的权重，带 † 的是官方文档逐条核过的，其余取自文档但未逐条复核——
真正驱动行为的那批（流水页八个端点）都钉在 `ledger.py:WINDOWS` 里，有测试盯着。

### 资产页 `/portfolio`

| 来源 | 端点 | 权重 | 缓存 | 说明 |
|---|---|---:|---:|---|
| `prices` | `GET /api/v3/ticker/price` | 4 | 30s | 全市场报价，不签名 |
| `wallets` | `GET /sapi/v1/asset/wallet/balance?needBalanceDetail=true` | 60 | 60s | **BTC 计价**，并保留逐资产明细 |
| `spot` | `POST /sapi/v3/asset/getUserAsset` | 5 | 60s | POST 但是只读 |
| `futures` | `GET /fapi/v3/account` | 5 † | 30s | 保证金与未实现盈亏 |
| | `GET /fapi/v1/accountConfig` | 5 † | 30s | 双向持仓 / 联合保证金 |
| | `GET /fapi/v3/positionRisk` | 5 | 30s | **标记价、强平价、开仓价只有这里有** |
| | `GET /fapi/v1/symbolConfig` | 5 | 30s | **杠杆倍数与全仓/逐仓只有这里有** |
| | `GET /fapi/v1/adlQuantile` | 5 | 30s | 自动减仓队列 |
| | `GET /fapi/v1/symbolAdlRisk` | 1 | 1800s | 标的级 ADL 风险，官方每 30 分钟更新 |
| | `GET /fapi/v1/exchangeInfo` | 1 | 1800s | TradFi 分类与合约元数据 |
| | `GET /fapi/v1/tradingSchedule` | 5 | 1800s | TradFi 各市场前后一周交易时段 |
| | `GET /fapi/v1/leverageBracket` | 1 | 24h | 维持保证金分档；重新取数不穿透 |
| `stocks` | `GET /sapi/v1/equity/market/tokenized-assets` | 1 | 6h | `AAPLB` 等钱包资产映射到股票代码；API key、不签名 |
| | `GET /sapi/v1/equity/market/exchangeInfo` | 1 | 6h | 可交易方向、碎股、延长时段与隔夜能力；API key、不签名 |
| | `GET /sapi/v1/equity/market/quote` | 1 / 标的 | 30s | 最新买一/卖一，官方说明最多约 5 秒延迟；缺任一侧时不生成中间价与盈亏 |
| `earn` | `GET /sapi/v1/simple-earn/flexible/position` | 150 | 300s | UID 限速；**阶梯年化 `tierAnnualPercentageRate` 就在这里**，不必另取产品列表 |
| | `GET /sapi/v1/simple-earn/locked/position` | 150 | 300s | UID 限速 |
| `bfusd` | `GET /sapi/v1/bfusd/history/rateHistory` | 150 | 300s | 最近公布年化；重新取数不穿透 |
| `margin` | `GET /sapi/v1/margin/account` | 10 | 60s | 全仓杠杆 |
| `liquidation_loan` | `GET /sapi/v1/margin/liquidation-loan` | 100 †（UID） | 60s | 杠杆启用才取；没有借款时回空响应体 |
| `income` | `GET /fapi/v1/income` | 30 † | 300s | 已实现 / 资金费 / 手续费 |
| `transfers` | `GET /sapi/v1/capital/deposit/hisrec` | 1 | 300s | 充值 |
| | `GET /sapi/v1/capital/withdraw/history` | **18000** | 900s | UID 限速 10 次/秒，最贵的一个 |
| `trades.*` | `GET /api/v3/myTrades` | 20 / 交易对 | 6h | `fromId` 翻页，**无时间上限** |
| `close.*` | `GET /api/v3/klines` | 2 / 交易对 | 900s | 日线收盘，不签名；`limit=WINDOW_DAYS+2` |
| `flows.earn_flexible` | `GET /sapi/v1/simple-earn/flexible/history/rewardsRecord` | 150 × 窗 × 页 | 1800s | UID 限速；`type=ALL`，只问 `REWARDS` 会漏掉阶梯奖励。**单次最多 30 天**，90 天窗按 ≤30 天切三段、每段翻页（`client.earn_rewards_history`）；2026-09-05 至 09-25 直接问 90 天，每次 -6021，派息没进逐日盈亏 |
| `flows.earn_locked` | `GET /sapi/v1/simple-earn/locked/history/rewardsRecord` | 150 × 窗 × 页 | 1800s | UID 限速；切窗与翻页同上 |
| `flows.interest` | `GET /sapi/v1/margin/interestHistory` | 1 | 1800s | 杠杆利息 |
| `flows.convert` | `GET /sapi/v1/convert/tradeFlow` | **3000** | 1800s | **只回 30 天** |
| `flows.dust` | `GET /sapi/v1/asset/dribblet` | 1 | 1800s | **只回 30 天** |
| `flows.equity_trades` | `GET /sapi/v1/equity/trade/history` | 1 | 1800s | 正股成交，用来回滚股数 |
| `close.equity.*` | Yahoo `chart/{symbol}`（**不是 Binance**） | — | 900s | 正股日线复权收盘；Binance 的股票接口没有日线也没有前收 |

后面这两组（`close.*` 与 `flows.*`）都是**逐日盈亏**要的，不是给别的地方用的：

- `close.*` 提供每天的收盘价。**按交易对逐个问**，所以只覆盖当前持有的币
  （`_cost_symbols`）——已清仓的币取不到日线，也就回滚不到。
  正股那几行（`close.equity.*`）是整个资产页上唯一不来自 Binance 的数据，理由见
  「正股那一份」一节。
- `flows.*` 提供"某天多了/少了几个币"，用来把历史持仓量从今天的余额往回滚。
  钱包之间的划转**不必问**：持有量按跨钱包统计，划转两头相抵。
  闪兑与小额兑换只回 30 天是硬限，更早的日子回滚不到，那几天会报 `null`。

`trades.*` 现在只剩两个用途：喂逐日盈亏的进出清单，以及推出要取哪些日线。
成本基础引擎（`Lot` / `replay` / `summarize`）已删，见 `costbasis.py`。

日快照（`accountSnapshot`，单次权重 2400）**已经不用了**：它只覆盖现货 / 全仓杠杆 /
U 本位三种，理财、资金、币本位没有历史快照，拿它算盈亏会把钱包间划转算成损益。

一次完整取数：SPOT 池约 **18 451 + 每个股票持仓一次报价**（提现一项就占 18 000；
正股成交历史权重 1），另加每个正股一次 Yahoo 日线（不占 Binance 权重），
FAPI 池 **63**（上表 fapi 各行相加）。`withdrawals` 与 BFUSD 年化列在
`NEVER_FORCE` 里；管理员成本保存在本地表，不消耗 Binance 权重，也不需要强制刷新上游。

### 委托页 `/orders`

| 来源 | 端点 | 权重 | 缓存 | 窗口上限 |
|---|---|---:|---:|---|
| 现货挂单 | `GET /api/v3/openOrders` | 6 †（不带 symbol 时 **80** †） | 30s | — |
| OCO | `GET /api/v3/openOrderList` | 6 † | 60s | — |
| 合约挂单 | `GET /fapi/v1/openOrders` | **40**（不带 symbol） | 30s | — |
| 合约条件单 | `GET /fapi/v1/openAlgoOrders` | **40**（不带 symbol） | 30s | TP/SL/追踪止损 |
| 杠杆挂单 | `GET /sapi/v1/margin/openOrders` | 10 | 30s | — |
| 策略单 | `GET /sapi/v1/algo/futures/openOrders` | 1 | 300s | — |
| 股票挂单 | `GET /sapi/v1/equity/order/open-orders` | 1 | 30s | 全部未完成委托；裸 ticker、USDC、股票时段 |
| 现货历史 | `GET /api/v3/allOrders` | 20 † / symbol | 300s | **24 小时** |
| 合约历史 | `GET /fapi/v1/allOrders` | 5 / symbol | 300s | 按 orderId 翻页，只回溯 90 天；symbol 可省但不用，见「委托页的硬边界」 |
| 合约收支 | `GET /fapi/v1/income` | 30 † | 300s | 找候选交易对；与 `/portfolio` 共用 `income` 缓存键 |
| 股票历史 | `GET /sapi/v1/equity/order/history` | 1 / 页 | 300s | 起止时间必填，不带 symbol 取全账户 90 天，最多 100 条/页 |
| 成交 | `GET /api/v3/myTrades` · `/fapi/v1/userTrades` | 20 † / 5 † | 300s | 同上 |
| 股票成交 | `GET /sapi/v1/equity/trade/history` | 1 / 页 | 300s | 逐笔成交；当前响应不含 maker 与逐笔手续费 |

现货与合约的委托和成交都按候选交易对扇出、按 id 翻页，避免只看最近一个时间窗。
股票委托与成交使用全账户分页查询，不需要从余额猜 ticker；其响应没有提供的 maker /
逐笔手续费保持 `null`。

### 流水页 `/ledger`

| 来源 | 端点 | 权重 | 窗口上限 | 回溯 | 扇出 |
|---|---|---:|---|---|---|
| 充值 | `GET /sapi/v1/capital/deposit/hisrec` | 1 | 90 天 | 90 天 | — |
| 提现 | `GET /sapi/v1/capital/withdraw/history` | **18000** | 90 天 | 90 天 | UID 10 次/秒 |
| 合约损益 | `GET /fapi/v1/income` | 30 | 不限 | 90 天 | — |
| 钱包划转 | `GET /sapi/v1/asset/transfer` | 1 | 不限 | 180 天 | **type 必填**，取 12 种常用 |
| 理财派息 | `GET /sapi/v1/simple-earn/*/history/rewardsRecord` | 150 | **30 天** | — | 活期与定期各一次 |
| 杠杆利息 | `GET /sapi/v1/margin/interestHistory` | 1 | 30 天 | 90 天 | — |
| 闪兑 | `GET /sapi/v1/convert/tradeFlow` | **3000** | 30 天 | — | 起止时间都必填 |
| 小额兑换 | `GET /sapi/v1/asset/dribblet` | 1 | 不限 | — | — |

**流水页的窗口上限是 30 天**，由理财派息与闪兑这两个 30 天的端点决定——
不是设计选的，是最紧的那个端点定的。界面上的 7 / 14 / 30 就是这么来的。

### 几个容易踩的点

- **`/sapi/v1/asset/wallet/balance` 返回的是 BTC**，不是 USD。不换算的话总净值差几万倍。
- **`/sapi/v1/margin/liquidation-loan` 没有借款时回 HTTP 200 + 0 字节响应体**，文档只给了
  有借款时的样例（2026-09-17 线上实测）。客户端换成 `{}` 而不是 None：payload 为 None
  的缓存不算命中，这个 UID 权重 100 的接口会每次刷新都重打一遍。
- **`liquidationPrice` 在全仓且余额充足时返回 `"0"`**，不是 null，也不是缺字段。
  当成 0 会算出"距强平 100%"，拿杠杆倒推会算出"距强平 1/杠杆"——两个都是错的，
  正确做法是留空。
- **`accountSnapshot` 只有 SPOT / MARGIN / FUTURES 三种**，没有理财、资金、币本位。
  拿它当期初、拿全部钱包当期末，差额会被整个算成盈亏。
- **`accountSnapshot` 只保留 30 天**，且只有账户有余额的那些天才有记录。曲线可能短于 30 天。
- **提现的 `applyTime` 是字符串**（`"2026-08-25 10:30:00"`，UTC），充值的 `insertTime`
  是毫秒整数。两边格式不一样。
- **非对称 key（Ed25519 / RSA）的签名是 base64，必须再做 URL 百分号编码**；
  HMAC 是 hex，不需要。混了会一直 `-1022 Signature for this request is not valid`。
- **服务器时间偏移**：`recvWindow` 默认 5000ms，本机时钟偏一点就全线 `-1021`。
  客户端会拉一次 `/api/v3/time` 或 `/fapi/v1/time` 校准后重试一次。

## 测试

`tests/test_binance_cache.py` 钉缓存层的降级语义（取数抛任何异常都只降级那一个来源）。
`tests/test_binance_{signing,client_contract,portfolio,orders,ledger}.py` 走 `httpx.MockTransport`，
喂**真实形状**的响应，不联网；`tests/test_dailypnl.py` 与 `tests/test_costbasis.py`
是纯逻辑，连 transport 都不需要——逐日盈亏的口径（持有、买入、充值、派息、手续费、
回滚不平、无报价、"空账户的 0 是真的 vs 算不出来的空"）钉在那里。
正股那一份也有自己的几条：昨收取自 Binance 之外、周末不抹空日历、取不到昨收时点名
而不是悄悄少一块。**假 Yahoo 是必须的**——假 Binance 拦不住它，`tests/test_binance_portfolio.py`
里有一个 autouse fixture 把它换掉，否则每跑一次测试就真去一趟 Yahoo。上面「读文档才知道的坑」那张表里的每一条都有测试盯着。样本在 `tests/binance_mock.py` 三组共用——各写一份必然漂移：
改了一处样本，另一处还在验旧形状，而两边都是绿的。

样本按用户的实际持仓形态编（美股永续 NVDA/QQQ 为主，现货只留 BNB 与稳定币）。

```bash
PYTHONPATH=. .venv/bin/python -m pytest tests/test_binance_*.py tests/test_dailypnl.py -q
```
