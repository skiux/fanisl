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

export function youtubeThumbnail(url: string | null | undefined, quality: 'large' | 'medium' = 'large') {
  const id = youtubeVideoId(url)
  if (!id) return null
  return quality === 'large'
    ? `/assets/knowledge/thumbnails/${id}.jpg`
    : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
}

export function creatorInitial(name: string) {
  return name.trim().slice(0, 1).toLocaleUpperCase()
}
