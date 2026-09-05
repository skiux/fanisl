# Binance 只读层（资产台后端）

给 `console/`（资产台）供数的三组接口：`/portfolio`、`/orders`、`/ledger`。
形状由 `console/src/api/types.ts` 定义，那份契约**按 Binance 原始字段写**，不是想当然的余额模型。

全员共用同一个 Binance 账户，凭据在服务器 `.env`，权限只开 Enable Reading。

## Key 类型

Binance 支持三种，官方把 **HMAC 标为 deprecated**、推荐 **Ed25519**。三种都支持，
按配置自动判型（`signing.py`），换类型只改 `.env`。启动时打印 `[fanisl] binance key 类型=…`。

| 类型 | 配置 | 签名 |
|---|---|---|
| Ed25519（推荐） | `BINANCE_PRIVATE_KEY_PATH` | PureEdDSA → base64 |
| RSA | 同上 | PKCS#1 v1.5 + SHA-256 → base64 |
| HMAC（deprecated） | `BINANCE_API_SECRET` | HMAC-SHA256 → hex |

非对称的好处对这个场景是实的：**私钥不出服务器**，Binance 只存公钥，所以交易所侧
即使出事也伪造不了你的请求。对只读 key 而言泄露的后果本来就有限，但成本也只是多跑一条
`openssl genpkey`。

两处写错就恒 401：
- **编码不同**：HMAC 出 hex，非对称出 base64。
- **base64 必须再 percent-encode**：签名里有 `+` `/` `=`，`+` 不编码会被服务端解成空格。
  代码里**无条件编码**（hex 编不编都一样）——少一个分支，也不会出现"只在某种 key 类型下
  才复现"的 bug。

```
client.py    HMAC 签名 + 错误分类 + 对时          ← 不含任何写入方法
cache.py     按来源的 TTL 缓存 + 降级语义
common.py    字符串数值解析、计价、钱包名映射
portfolio.py /portfolio  资产快照（12 个端点）
orders.py    /orders     委托（8 个端点）
ledger.py    /ledger     流水（8 个端点，20 次调用）
```

## 为什么不用 ccxt（项目里已经装着）

它的统一模型会把这三页要的字段抹掉：现货四种锁定态（free/locked/freeze/withdrawing）、
ADL 排队分位、条件单的 `workingType`/`closePosition`、`leverageBracket` 的维持保证金档位、
日快照、理财持仓、小额兑换、闪兑。绕一层统一模型再拆回来只会丢字段，而签名本身是 40 行 HMAC。

`client.py` 里**没有任何下单、划转、提现方法**——不是忘了写。这个进程持有的 key 只该有
读权限，代码里也不该存在写入路径；将来有人想加，得先解释为什么。

## 三条不肯让步的口径

**取不到就是 `null`，不拿 `0` 顶替。** `0` 是一个有效余额。`common.dec()` 解析失败返回
`None` 而不是 `0`，需要"缺失即 0"的场合显式用 `dec0()`。

**日快照是 BTC 计价的**，换 USD 必须用**当天**的 BTC 收盘价。拿今天的价乘 30 天前的余额，
画出来的是 BTC 的走势不是账户的。为此多取一条日线（公开端点，权重 2）。

**归因算不出来就整块留空。** 恒等式
`期末 = 期初 + 净充提 + 已实现 + 未实现变动 + 资金费 + 手续费`
缺任一项都不闭合，与其给一张对不上账的表不如不给。

## 按来源降级

每个端点单独取、单独缓存、单独记状态。用户网络里的 451 是**间歇的、而且常常只打在
fapi 上**，现货那半边不该跟着一起坏。

| 情况 | 返回 | 前端表现 |
|---|---|---|
| 新鲜 | 数据 + `status=ok` + 取数时刻 | 正常 |
| 过期但取到了 | 新数据 | 正常 |
| 过期且失败 | **旧数据** + 真实失败原因 + **旧时刻** | 蒙上 `.veiled`，标红原因 |
| 从未成功 | `null` | 留空，不是 0 |

**装配失败也按来源降级。** 缓存层只兜得住网络与 HTTP 错误（`BinanceError`），而字段解析
在它外面——Binance 改一次字段类型（数组元素从对象变字符串这类），整页就会 500，
而 nginx 只给一句 Bad Gateway。所以每一块装配都过 `common.guard()`：失败时这一块变
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

`/portfolio`、`/orders`、`/ledger` 共用同一批缓存键（`prices`、`spot`、`futures.risk`），
先开哪一页，另外两页就少几次调用。

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
| `/fapi/v2/account` **没有**标记价、强平价、ADL 分位 | 在 `positionRisk` 与 `adlQuantile` 上。少了它们"距强平多远"无从算起 |
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

## 盈亏怎么算（`costbasis.py` + `portfolio.py:_pnl`）

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
today.spot_mark_usd     现货盯市：Σ 持有量 × (现价 − 昨日 UTC 收盘)
today.settled_usd       当日结算 = daily 最后一格
unrealized.futures_usd  positionRisk 的 unRealizedProfit（交易所给的标记价）
realized.spot_usd       myTrades 全量重放，卖出按当时的均价结转
realized.futures_usd    income 的 REALIZED_PNL
carry.*                 资金费 / 手续费 / 返佣
daily[]                 每天**结算**落袋多少：income 逐行按天分桶 + 现货成交按天结转
                        不含盯市——往前的每一天要盯市就得知道那天持有多少，
                        而历史持仓量拿不到。所以最后一格 ≠ today.total_usd
```

**`unrealized` 里没有现货。** 现货看的是今天涨跌多少（盯市），不是相对买入成本的
未实现——理由见下面第 ① 条。

划转不是成交，动不了任何一个币的数量与成本，所以这条路对划转完全免疫；
盯市按跨钱包持有量算，同样不受划转影响。

### 四个修过的坑

**① 现货根本不该算"未实现"。** 它是市值减加权平均成本，而那个成本要**完整的买入
历史**。这个账户拿不到：划转 / 理财派息 / 小额兑换 / 闪兑进来的币从不出现在
`myTrades` 里，`capital/deposit/hisrec` 又只回 90 天，更早的充值永远查不回来。

为它修过三轮，一轮比一轮更像那么回事，但没有一轮解决问题：

1. 拿 `cost_usd / 重放数量` 的均价去乘**余额的全部数量**——等于假设没见过买入记录
   的币和见过的同价。实测重放 1 个 BNB @ $650、实际持有 6.712 个，未实现算成
   +$215.79，有据可依的只有 +$32.15。
2. 只对 `min(余额, 重放数量)` 算，多出来的报在 `unpriced_qty`。不虚高了，
   但报出去的仍是一个永远缺一块的数。
3. 开一条人工通道让管理员手填均价。这是在给一个不该问的问题找答案。

**现货要回答的是"今天涨跌了多少"，那就盯市：`持有量 ×（现价 − 昨收）`。**
只要数量和两个价格，不需要任何历史，也就没有任何补不齐的东西。见
`portfolio._spot_today`；昨收取自 `klines(symbol, "1d", limit=2)` 的**倒数第二根**
——最后一根是今天这根、还在走，拿它当昨收今日盈亏永远是 0。取不到昨收的币留空，
不按"没动"记 0；一个币都算不出来时整项是 `null` 而不是 0。

合约那半边不一样：`unRealizedProfit` 是交易所按自己的开仓均价给的，拿来即用——
所以 `pnl.unrealized` 里**只有合约**。已实现也留着，它只认真实发生过的卖出，
重放给得全。

**② `income` 的金额单位是该行的 `asset`，不一定是 USDT。** 手续费常用 BNB 抵扣
（`asset: "BNB", income: "-0.012"`）。不看 asset 直接相加等于把 0.012 个 BNB
当成 0.012 美元，手续费凭空少几十倍。已按币种换算，换不出价的单独计数不当 0 吞。

**③ 划进合约 / 杠杆 / 理财的币要算进持有量。** `/fapi/v2/account` 的 `assets` 数组、
`/sapi/v1/margin/account` 的 `userAssets` 原先整段没读。持有量按"账户一共有多少"
算，不认钱包，否则划走的部分会显示成卖掉了。合约那边用 `walletBalance` 而不是
`marginBalance`——后者含浮盈，那是仓位的钱不是多出来的币。

**"现货数据取不到"多半就是这一条**：币划进了合约钱包当保证金，量一直都在，
只是当初只读了现货余额。盯市与已实现都走 `held_across_wallets`。

**④ 稳定币是计价单位，不是有成本的持仓。** USDT 的成本恒等于面值。当成普通仓位记，
会因为"没见过它怎么进来的"被标成成本不明，进而把账户里最大的一块从已实现里剔掉。

### 三个窗口不一样，别加成一个数

| | 窗口 | 为什么 |
|---|---|---|
| 现货已实现 | 全历史 | `myTrades` 用 `fromId` 翻页，没有时间上限 |
| 合约已实现 / 资金费 / 手续费 | 90 天 | `income` 接口只保留 90 天 |
| 未实现（两边） | 此刻 | `positionRisk` 是当前值，没有窗口概念 |

把"现货全历史 + 合约 90 天"加起来，不是任何一个真实区间的成绩。界面上因此
**删掉了「已实现盈亏」那个合计**，只在盈亏页逐项列。

### 覆盖不全是硬限，要说出来

`myTrades` 的 `symbol` 必填，而 Binance **没有"我交易过哪些对"的接口**。候选是从
当前持有的币 × USDT 推的，所以**已经清仓的币查不到**——它不在余额里，就没有线索
指向它的交易对，而它的已实现是真金白银。这条写在响应的 `coverage` 里，不假装总数是全的。

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
**历史只能按交易对逐个问**（`allOrders`/`myTrades` 的 symbol 必填，现货单次 ≤ 24 小时、
合约 < 7 天、回溯 90 天）。

而 Binance **没有"我交易过哪些对"的接口**，只能从「有挂单 + 有持仓 + 现货余额能配出的
交易对」推一份候选。做不到真正的全量，这一点界面上也说明白。

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
| `wallets` | `GET /sapi/v1/asset/wallet/balance` | 60 | 60s | **BTC 计价**，要乘 BTCUSDT |
| `spot` | `POST /sapi/v3/asset/getUserAsset` | 5 | 60s | POST 但是只读 |
| `futures` | `GET /fapi/v2/account` | 5 † | 30s | 保证金与未实现盈亏 |
| | `GET /fapi/v1/accountConfig` | 5 † | 30s | 双向持仓 / 联合保证金 |
| | `GET /fapi/v2/positionRisk` | 5 | 30s | **标记价与强平价只有这里有** |
| | `GET /fapi/v1/adlQuantile` | 5 | 30s | 自动减仓队列 |
| `earn` | `GET /sapi/v1/simple-earn/flexible/position` | 150 | 300s | UID 限速 |
| | `GET /sapi/v1/simple-earn/locked/position` | 150 | 300s | UID 限速 |
| `margin` | `GET /sapi/v1/margin/account` | 10 | 60s | 全仓杠杆 |
| `income` | `GET /fapi/v1/income` | 30 † | 300s | 已实现 / 资金费 / 手续费 |
| `transfers` | `GET /sapi/v1/capital/deposit/hisrec` | 1 | 300s | 充值 |
| | `GET /sapi/v1/capital/withdraw/history` | **18000** | 900s | UID 限速 10 次/秒，最贵的一个 |
| `trades.*` | `GET /api/v3/myTrades` | 20 / 交易对 | 6h | `fromId` 翻页，**无时间上限**；喂现货成本基础 |

日快照（`accountSnapshot`，单次权重 2400）**已经不用了**：它只覆盖现货 / 全仓杠杆 /
U 本位三种，理财、资金、币本位没有历史快照，拿它算盈亏会把钱包间划转算成损益。
盈亏改成从成交重放（见 `costbasis.py`）。

一次完整取数：SPOT 池约 **18 300**（提现一项就占 18 000），FAPI 池约 **50**。
`withdrawals` 列在 `NEVER_FORCE` 里——"重新取数"穿不透它。

### 委托页 `/orders`

| 来源 | 端点 | 权重 | 缓存 | 窗口上限 |
|---|---|---:|---:|---|
| 现货挂单 | `GET /api/v3/openOrders` | 6 †（不带 symbol 时 **80** †） | 30s | — |
| OCO | `GET /api/v3/openOrderList` | 6 † | 60s | — |
| 合约挂单 | `GET /fapi/v1/openOrders` | **40**（不带 symbol） | 30s | — |
| 杠杆挂单 | `GET /sapi/v1/margin/openOrders` | 10 | 30s | — |
| 策略单 | `GET /sapi/v1/algo/futures/openOrders` | 1 | 300s | — |
| 现货历史 | `GET /api/v3/allOrders` | 20 † / symbol | 300s | **24 小时** |
| 合约历史 | `GET /fapi/v1/allOrders` | 5 † / symbol | 300s | **7 天**，只回溯 90 天 |
| 成交 | `GET /api/v3/myTrades` · `/fapi/v1/userTrades` | 20 † / 5 † | 300s | 同上 |

历史类端点**必须传 symbol**，所以是按标的扇出——持仓越多调用次数越多。
而且**必须按 id 翻页，不能按时间窗**：`startTime`/`endTime` 的间隔上限是 24 小时
（现货）/ 7 天（合约），只取最近一个窗口的话，上次交易在窗口之前就是一片空白。

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

`tests/test_binance_{signing,portfolio,orders,ledger}.py`，全部用 `httpx.MockTransport`
喂**真实形状**的响应，不联网。上面「读文档才知道的坑」那张表里的每一条都有测试盯着。样本在 `tests/binance_mock.py` 三组共用——各写一份必然漂移：
改了一处样本，另一处还在验旧形状，而两边都是绿的。

样本按用户的实际持仓形态编（美股永续 NVDA/QQQ 为主，现货只留 BNB 与稳定币）。

```bash
PYTHONPATH=src .venv/bin/python -m pytest tests/test_binance_*.py -q
```
