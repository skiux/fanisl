import { apiJson, type ApiRequestInit, type JsonValidator } from './client'

type Page<T> = { items: T[]; total: number }

/**
 * 取一个分页接口的全部条目：先取第一页拿到 total，再把其余页并发取回。
 *
 * 试过"记住上次的总数、一开始就把所有页一起发出去"来省掉一轮往返：按线上实测条件
 * （往返约 0.35s、带宽约 300KB/s）回放，验证页反而从 6.4s 变成 7.4s——瓶颈在带宽，
 * 一起发只是让请求互相抢带宽、撞上浏览器对同一站点的并发连接上限。所以保持两轮。
 */
export async function fetchAllPages<T>(
  url: (offset: number) => string,
  pageSize: number,
  init: ApiRequestInit,
  validate: JsonValidator<Page<T>>,
): Promise<T[]> {
  const first = await apiJson<Page<T>>(url(0), init, validate)
  const offsets: number[] = []
  for (let offset = pageSize; first.items.length > 0 && offset < first.total; offset += pageSize) offsets.push(offset)
  const rest = await Promise.all(offsets.map((offset) => apiJson<Page<T>>(url(offset), init, validate)))
  return [...first.items, ...rest.flatMap((page) => page.items)]
}
