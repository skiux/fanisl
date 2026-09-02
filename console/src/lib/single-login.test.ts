import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// vitest 的 cwd 是 console/，仓库根在它上一层。不用 import.meta.url——
// 那个在 vite 的转换下会变成 /@fs/... 前缀，readdir 读不了。
const ROOT = resolve(process.cwd(), '..') + '/'
const SKIP = new Set(['node_modules', '.git', 'dist', '.venv', 'playwright-report', 'test-results'])

function walk(dir: string, hits: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, hits)
    else if (/LoginPage\.tsx?$/.test(name)) hits.push(full.slice(ROOT.length))
  }
  return hits
}

describe('登录页', () => {
  it('全仓库只有一个', () => {
    // 一套账号、一个域名，就该只有一扇门。控制台与知识引擎原先各写了一个，
    // 长得还不一样——哪一扇都不算错，"有两扇"才是错的。
    expect(walk(ROOT).sort()).toEqual(['shared/login/LoginPage.tsx'])
  })
})
