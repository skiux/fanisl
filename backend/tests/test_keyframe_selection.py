"""关键帧取舍判据：帧能不能回答笔记回答不了的问题。"""

from analyzer.knowledge.backfill_keyframes import worth_a_frame


# --- 图表/表格：折线形状、表格格子，文字装不下 ----------------------------

def test_chart_and_table_always_kept_even_without_numbers():
    assert worth_a_frame("chart", "SOXX 7-Day K-line chart, showing sector bottoming.")
    assert worth_a_frame("table", "板块涨跌一览")


def test_chart_kept_when_note_is_empty():
    """笔记越空，帧越是唯一记录——不能因为笔记没写就丢掉画面。"""
    assert worth_a_frame("chart", "")
    assert worth_a_frame("chart", None)


# --- 纯文字画面：笔记就是那段文字，帧没有增量 ------------------------------

def test_title_cards_and_logos_dropped():
    assert not worth_a_frame("text_slide", "章节标题：投入失控？")
    assert not worth_a_frame("text_slide", "美投君开场Logo：“美投君-你们的美股探路者”")
    assert not worth_a_frame("other", "聚焦展示Twilio的红色四个白点圆形Logo")


def test_long_handwritten_text_still_dropped_without_numbers():
    """长度不是判据：手写板书再长，笔记也已经把那段字完整记下来了。"""
    note = ("电力革命的3个阶段：第一个阶段是技术成熟期（电机作为单点降本工具）；"
            "第二个阶段是组织创新期（通过分组电机优化局部，提效）；"
            "第三个阶段是组织重构期（围绕电机重构工厂，生产力爆发）")
    assert len(note) > 60
    assert not worth_a_frame("text_slide", note)


# --- 精确数值：会被转录改写且改写后无从发现，帧是仲裁 ----------------------

def test_text_slide_with_precise_numbers_kept():
    assert worth_a_frame("text_slide", "失业率维持4.3%符合预期")            # 百分比
    assert worth_a_frame("text_slide", "SOX 的 forward PE 是 19.94 倍")     # 小数+倍数
    assert worth_a_frame("other", "众议院：民主党胜率 84%")
    assert worth_a_frame("text_slide", "新增就业+17.2万 > 预期的+8万")


def test_bare_year_is_not_a_precise_number():
    """"2026年展望"是叙述不是读数，不该因此保住一张标题卡。"""
    assert not worth_a_frame("text_slide", "2026年下半年展望")
    assert not worth_a_frame("text_slide", "章节标题：2026 年的机会")


def test_lite_model_incident_case_is_kept():
    """gemini-3.5-flash-lite 把 19.94 倍写成 9.94 倍那次，帧是唯一能翻案的凭据。"""
    assert worth_a_frame("text_slide", "费城半导体指数 forward PE 19.94")


# --- 不做关键词广告过滤：误删真实数据图的代价更大 --------------------------

def test_no_keyword_ad_filter_so_real_charts_survive():
    """'Pro' 会命中 Procore，'订阅' 会命中 FSD 订阅数——都是真实数据。"""
    assert worth_a_frame("chart", "Procore Technologies (PCOR) 月线图")
    assert worth_a_frame("text_slide", "FSD订阅用户由128万增加到148万，同比大涨56%")
    assert worth_a_frame("chart", "MSFT 日K。标注现价：454.72。气泡框：‘美投Pro：下周微软估值’")


def test_promo_without_numbers_is_dropped_by_the_general_rule():
    assert not worth_a_frame("text_slide", "美投Pro：跟踪企业业务、技术、财报、估值、风险")
