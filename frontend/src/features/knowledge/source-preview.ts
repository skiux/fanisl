import type {
  KnowledgeContentDetail,
  KnowledgeContentSummary,
  KnowledgeContentUnit,
  KnowledgeKind,
} from './types'

type PreviewUnitInput = {
  id: number
  kind: KnowledgeKind
  locator: string | null
  payload: Record<string, unknown>
  quote: string
  tags: string[]
}

export type PreviewSourceBundle = {
  detail: KnowledgeContentDetail
  units: KnowledgeContentUnit[]
}

const publishedAt: Record<number, string> = {
  12: '2026-05-18T20:00:00+08:00',
  13: '2026-07-12T20:00:00+08:00',
  17: '2026-05-31T20:00:00+08:00',
}

function unit(contentId: number, input: PreviewUnitInput): KnowledgeContentUnit {
  return {
    id: input.id,
    run_id: contentId,
    content_id: contentId,
    creator_id: contentId === 12 ? 1 : 2,
    published_at: publishedAt[contentId],
    kind: input.kind,
    quote: input.quote,
    locator: input.locator,
    extractor_version: 'pending-v1',
    model: 'claude-session',
    payload: input.payload,
    tags: input.tags,
    ref_price_at_publish: null,
    created_at: publishedAt[contentId],
    scores: [],
  }
}

function sourceSummary(
  id: number,
  creatorId: number,
  creator: string,
  videoId: string,
  title: string,
  date: string,
  rawLength: number,
  counts: [number, number, number],
  scores: [number, number, number] = [0, 0, 0],
): KnowledgeContentSummary {
  const [claims, methods, concepts] = counts
  const [hit, partial, miss] = scores
  return {
    id,
    creator_id: creatorId,
    creator,
    platform: 'youtube',
    url: `https://www.youtube.com/watch?v=${videoId}`,
    content_type: 'video',
    title,
    published_at: `${date}T20:00:00+08:00`,
    fetched_at: `${date}T23:00:00+08:00`,
    lang: 'zh',
    status: 'extracted',
    raw_len: rawLength,
    n_units: claims + methods + concepts,
    n_claims: claims,
    n_methods: methods,
    n_concepts: concepts,
    n_hit: hit,
    n_partial: partial,
    n_miss: miss,
  }
}

export const previewSourceContents: KnowledgeContentSummary[] = [
  sourceSummary(13, 2, '美投君', '0kvj3lbJqoY', 'AI竟与100年前电力革命如此相似？90%的人都看错方向，历史已指明最大商机！', '2026-07-12', 13657, [3, 0, 6]),
  sourceSummary(1, 1, 'Andy Lee 财经', '9q2VneDmauM', '如何看美股牛熊指标超买？半导体板块最佳节奏！AUDJPY是风险领先指标。', '2026-07-12', 7888, [8, 2, 5]),
  sourceSummary(3, 1, 'Andy Lee 财经', 'xZp3zzsdc8U', '扭曲油价的风险，韩指暴跌如何看？美股财报季，花旗定量模型。', '2026-07-07', 8249, [8, 3, 5]),
  sourceSummary(2, 2, '美投君', 'px5M4ry8IO4', '涨的要跌？跌的要涨？下半年2大风险，1大致富机会，你必须了解！', '2026-07-05', 12636, [7, 1, 8], [0, 0, 1]),
  sourceSummary(4, 1, 'Andy Lee 财经', 'TFnsaRDIpIU', '股强金弱格局，下半年会继续吗？关注一个指标！闪迪、美光、CRCL、BTC、XLV跟踪。', '2026-07-01', 6302, [11, 2, 4], [2, 0, 3]),
  sourceSummary(5, 1, 'Andy Lee 财经', 'Hg2RjmU0IU8', '精准预判下跌，后市美股黄金如何看，AI交易新的机会在哪？', '2026-06-24', 9368, [14, 2, 6], [2, 0, 0]),
  sourceSummary(14, 2, '美投君', '-ih9NBMHiU8', 'AI商业发展暗藏4大前瞻趋势！提前埋伏这些机会，押注下一轮AI暴涨？', '2026-06-21', 10182, [3, 0, 6]),
  sourceSummary(6, 1, 'Andy Lee 财经', '7nByo0IjiBE', '风险信号：美元指数上破101，黄金与美股关键价位再分析。', '2026-06-19', 4757, [8, 1, 5], [2, 0, 0]),
  sourceSummary(7, 1, 'Andy Lee 财经', 'aRyOMsKkm3g', '如期反弹，黄金、纳指、SOXX、IGV目标和压力分析，川普签啥协议由他去吧！', '2026-06-15', 6659, [8, 3, 3], [2, 0, 5]),
  sourceSummary(15, 2, '美投君', 'ByBLjNA3MvY', '高手是如何在牛市中赚钱的？1招让你告别踏空，无惧下跌！', '2026-06-14', 7241, [1, 1, 5]),
  sourceSummary(8, 1, 'Andy Lee 财经', 'gtY5Md7o1W4', '如期回调。纳指、半导体后市判断，黄金的牛熊分水岭，Nvda与TSLA。', '2026-06-09', 6844, [10, 1, 4], [3, 0, 6]),
  sourceSummary(16, 2, '美投君', 'xEkNd6xG1qo', '美股涨到头了？这3类股票不要碰！还有1类反而出大机会？', '2026-06-08', 8970, [7, 2, 6], [1, 0, 1]),
  sourceSummary(9, 1, 'Andy Lee 财经', '7DR2q2gXiZs', '软件板块再续强势，盘点投行推荐的低位股，CRWV CRM TEAM，纳指面临均值回归？', '2026-06-01', 6027, [10, 0, 4], [2, 0, 6]),
  sourceSummary(17, 2, '美投君', 'tUI3ITjo2Bw', 'AI是威胁？还是机遇？软件股多点开花预示什么？哪些公司能率先迎来爆发？', '2026-05-31', 16151, [6, 1, 6], [0, 0, 2]),
  sourceSummary(10, 1, 'Andy Lee 财经', 'XzV-L9PjdV0', '美光的新目标和支撑分析，纳指30000点后怎么看，黄金白银BTC原油跟踪。', '2026-05-27', 5388, [9, 1, 4], [2, 1, 5]),
  sourceSummary(11, 1, 'Andy Lee 财经', 'nfWDeKeJjyY', 'NVDA TSLA MU MRVL QCOM等分析，半导体还是周期行业吗？', '2026-05-22', 10601, [12, 1, 3], [4, 0, 0]),
  sourceSummary(18, 2, '美投君', '91yRxsdc0gA', '00年互联网泡沫，半导体都发生了什么？悲剧重演？历史已给出答案！', '2026-05-18', 10225, [4, 1, 6]),
  sourceSummary(12, 1, 'Andy Lee 财经', 'muTemJOTM58', '美债会通杀市场吗？金银油、纳指、SOXX关键判断依据。', '2026-05-18', 5638, [6, 1, 3], [1, 0, 5]),
]

const previewUnits: Record<number, KnowledgeContentUnit[]> = {
  13: [
    unit(13, {
      id: 1301,
      kind: 'claim',
      locator: '23:57',
      quote: '所以单纯从现在的情况来看，我认为Meta是最有可能率先跑出AI采纳的企业。如今的Meta就非常类似于当年的福特，从资质上，它有望通过AI采纳来提升自己，也有望因此而带动起整个行业的增长',
      tags: ['meta', 'mag7', 'ai-capex'],
      payload: {
        asset_text: 'Meta（AI采纳先驱候选）',
        asset_symbol: 'META',
        direction: 'up',
        verifiability: 'B',
        scoring_spec: {
          eval_ladder: ['2026-10-10', '2027-07-12'],
          success_def: '阶梯日 META 收盘不低于发布日收盘，作为长期逻辑的机械观察口径。',
        },
      },
    }),
    unit(13, {
      id: 1302,
      kind: 'concept',
      locator: null,
      quote: '因为互联网革命它本质上是一场信息革命，它解决的是信息的传递效率；而AI本质上是一场生产力革命，它解决的是生产效率',
      tags: ['ai-capex', 'macro-data'],
      payload: {
        canonical_statement: 'AI的正确历史类比是电力革命而非互联网革命：前者改变生产效率，后者改变信息传递效率。',
        category: 'macro_framework',
      },
    }),
    unit(13, {
      id: 1303,
      kind: 'concept',
      locator: '10:45',
      quote: '所以你看，电力革命真正的爆发点，不在于电机的发明，也不在于蒸汽机的替代，而是在于工厂组织架构基于电力的彻底重构。可以说技术创新只是前提，而组织架构的重构才是爆发的关键',
      tags: ['ai-capex', 'macro-data'],
      payload: {
        canonical_statement: '技术创新只是前提，组织架构围绕新动力源的彻底重构才是生产力革命的爆发点。',
        category: 'macro_framework',
        regime_qualifier: '生产力革命早期',
      },
    }),
  ],
  17: [
    unit(17, {
      id: 1701,
      kind: 'claim',
      locator: '16:01',
      quote: '但是对于软件股整体而言，现在这个时间点我认为，是收益风险比非常高的时刻，那么软件股ETF IGV就是不错的选择',
      tags: ['igv', 'software', 'ai-capex'],
      payload: {
        asset_text: '软件板块 ETF（IGV）',
        asset_symbol: 'IGV',
        direction: 'up',
        verifiability: 'B',
        scoring_spec: {
          eval_ladder: ['2026-06-07', '2026-06-30', '2026-08-29'],
          success_def: '阶梯日 IGV 收盘不低于发布日收盘。',
        },
      },
    }),
    unit(17, {
      id: 1702,
      kind: 'method',
      locator: '13:01',
      quote: '第一，To B尤其是To大B的软件，要明显优于To C或者To小B的软件；第二，AI已经明确带来了新增收入；第三，他们的商业模式为按量收费，或者引入了按量收费的模式并成功兑现',
      tags: ['software', 'ai-capex'],
      payload: {
        name: 'AI时代软件股三共性选股框架',
        summary: '以 To 大B、AI 新增收入和按量收费三项条件筛选软件公司。',
        family: 'positioning',
        testability: 'B',
      },
    }),
    unit(17, {
      id: 1703,
      kind: 'concept',
      locator: '11:03',
      quote: '在AI Agent时代，token变成了软件公司自己的成本。以前软件公司都是以高毛利著称，但是现在用户使用AI去烧token是要软件公司自己掏钱的',
      tags: ['software', 'ai-capex'],
      payload: {
        canonical_statement: '席位制 SaaS 在 AI 时代同时面临席位减少和 token 成本转嫁困难，收费模式需要向使用量迁移。',
        category: 'market_structure',
      },
    }),
  ],
  12: [
    unit(12, {
      id: 1201,
      kind: 'claim',
      locator: '10:56',
      quote: '在整个框架里面我们对纳指100的判断就是要守28800点。守不住回到什么？26500点这个区域去看',
      tags: ['ndx', 'price-action'],
      payload: {
        asset_text: '纳指100',
        asset_symbol: 'NDX',
        direction: 'down',
        verifiability: 'C',
        condition_text: '日收盘跌破 28800',
        scoring_spec: {
          eval_ladder: ['2026-08-16'],
          success_def: '若日收盘跌破 28800，其后观察是否触及 26500。',
        },
      },
    }),
    unit(12, {
      id: 1202,
      kind: 'claim',
      locator: '06:12',
      quote: '我们现在应该关注的中期的位置就是黄金的日线级别隧道的支撑。这个支撑位呢，大概呢是4300到4400，然后极端的价格到4100左右',
      tags: ['xauusd', 'price-action', 'ema-tunnel'],
      payload: {
        asset_text: '黄金',
        asset_symbol: 'XAUUSD',
        direction: 'range',
        verifiability: 'B',
        scoring_spec: {
          eval_ladder: ['2026-06-17', '2026-07-17'],
          success_def: '观察黄金日收盘是否守住 4300；4100 为极端补偿位。',
        },
      },
    }),
    unit(12, {
      id: 1203,
      kind: 'claim',
      locator: '07:36',
      quote: '它要比黄金震荡更多，并不代表它更弱，从中期来看的话它没有更弱',
      tags: ['xagusd', 'xauusd'],
      payload: {
        asset_text: '白银（相对黄金）',
        asset_symbol: 'XAGUSD',
        direction: 'flat',
        verifiability: 'B',
        scoring_spec: {
          eval_ladder: ['2026-07-17'],
          success_def: '以白银相对黄金的同期收益率判断“中期不更弱”。',
        },
      },
    }),
  ],
}

function detailFor(content: KnowledgeContentSummary): KnowledgeContentDetail {
  const excerpts = (previewUnits[content.id] ?? []).map((item) => item.quote).join('\n\n')
  const transcript = excerpts || '离线预览未携带本期完整转录。连接知识接口后，这里将显示数据库中保存的不可变原文。'
  return {
    id: content.id,
    creator_id: content.creator_id,
    creator: content.creator,
    platform: content.platform,
    url: content.url,
    content_type: content.content_type,
    title: content.title,
    published_at: content.published_at,
    fetched_at: content.fetched_at,
    lang: content.lang,
    status: content.status,
    raw: `${transcript}\n\n## 视觉笔记（画面信息，带时间戳）\n- 预览模式仅保留经过逐字核对的节选。`,
    created_at: content.fetched_at,
  }
}

export const previewSourceBundles = Object.fromEntries(
  previewSourceContents.map((content) => [
    content.id,
    { detail: detailFor(content), units: previewUnits[content.id] ?? [] },
  ]),
) as Record<number, PreviewSourceBundle>
