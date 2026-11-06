import { describe, expect, it } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseM3u } from '@/services/m3uParser'

const demoRoot = resolve('docs/demo')
const rawBase = 'https://raw.githubusercontent.com/eduardoVL123/reprodutor_de_video-/main/docs/demo/'

describe('lista real de demonstração (RFC-026)', () => {
  it('oferece 16 itens com capa, 7 grupos e os dois HLS atuais', async () => {
    const text = readFileSync(resolve(demoRoot, 'pulse-demo.m3u'), 'utf8')
    const parsed = await parseM3u(text)
    const items = [...parsed.liveStreams, ...parsed.vodStreams]
    expect(items).toHaveLength(16)
    expect(parsed.liveStreams).toHaveLength(2)
    expect(new Set([...parsed.liveCategories, ...parsed.vodCategories].map((cat) => cat.category_name)).size).toBe(7)
    expect(parsed.liveStreams.map((item) => item.directUrl)).toEqual([
      'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      'https://test-streams.mux.dev/tos_ismc/main.m3u8',
    ])
    for (const item of items) {
      expect(item.stream_icon).toMatch(/^https:\/\//)
      const relative = item.stream_icon.slice(rawBase.length)
      expect(item.stream_icon.startsWith(rawBase)).toBe(true)
      expect(statSync(resolve(demoRoot, relative)).size).toBeGreaterThan(1000)
    }
    const urls = text.split(/\r?\n/).filter((line) => line && !line.startsWith('#'))
    expect(urls).toHaveLength(16)
    expect(urls.every((url) => url.startsWith('https://'))).toBe(true)
    const own = urls.filter((url) => url.startsWith(rawBase + 'media/'))
    expect(own).toHaveLength(10)
    for (const url of own) {
      const size = statSync(resolve(demoRoot, url.slice(rawBase.length))).size
      expect(size).toBeGreaterThan(1000)
      expect(size).toBeLessThan(1_000_000)
    }
    expect(text).not.toMatch(/IPTV|nasa/i)
  })
})
