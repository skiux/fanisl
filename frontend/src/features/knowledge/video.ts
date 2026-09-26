export function youtubeVideoId(url: string | null | undefined) {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] ?? null
    if (parsed.hostname.endsWith('youtube.com')) return parsed.searchParams.get('v')
  } catch {
    return null
  }
  return null
}

/**
 * 内容卡片的缩略图。线上内容直接取 YouTube 的 hqdefault（480×360，16:9 视频上下带黑边，卡片按 cover 裁掉）。
 * 仓库里只给离线样本存了 18 张本地图，只在后端不通、显示样本时用：原先一律先试本地、失败再换 YouTube，
 * 线上 200 多张里只有这 18 张本地有，其余每张都先白请求一次（nginx 回的是 index.html）。
 */
export function youtubeThumbnail(url: string | null | undefined, source: 'remote' | 'local' = 'remote') {
  const id = youtubeVideoId(url)
  if (!id) return null
  return source === 'local'
    ? `/assets/knowledge/thumbnails/${id}.jpg`
    : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
}

/**
 * 卡片与阅读页上显示的标题：去掉 YouTube 标题里的话题标签（#CPI #nvda …）、✨ 和结尾的八位日期
 * （投资TALK君每期都这样收尾，日期另有一栏）。只改显示，搜索仍按原标题。
 */
export function displayTitle(title: string) {
  const stripped = title.replace(/#[^\s#]+/g, '').replaceAll('✨', '').trim()
  return stripped.replace(/(?<=\D)\d{8}$/, '').replace(/\s+/g, ' ').trim() || title
}
