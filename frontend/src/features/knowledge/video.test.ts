import { describe, expect, it } from 'vitest'
import { displayTitle, youtubeThumbnail } from './video'

describe('内容卡片', () => {
  it('标题去掉话题标签、✨ 与结尾日期，其余原样', () => {
    expect(displayTitle('✨【投资TALK君1498期】甲骨文木星计划失手？资金链断裂？✨20260924#CPI #nvda #美股 #投资'))
      .toBe('【投资TALK君1498期】甲骨文木星计划失手？资金链断裂？')
    expect(displayTitle('巨震后，关注七巨头的防御性：AAPL  MSFT AMZN')).toBe('巨震后，关注七巨头的防御性：AAPL MSFT AMZN')
    expect(displayTitle('#只有标签')).toBe('#只有标签')
  })

  it('线上缩略图直接取 YouTube，本地图只给离线样本', () => {
    const url = 'https://www.youtube.com/watch?v=LhSFkl-eN5s'
    expect(youtubeThumbnail(url)).toBe('https://i.ytimg.com/vi/LhSFkl-eN5s/hqdefault.jpg')
    expect(youtubeThumbnail(url, 'local')).toBe('/assets/knowledge/thumbnails/LhSFkl-eN5s.jpg')
    expect(youtubeThumbnail('https://example.com/a')).toBe(null)
  })
})
