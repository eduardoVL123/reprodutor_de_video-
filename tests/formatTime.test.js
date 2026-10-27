import { describe, it, expect } from 'vitest'

describe('formatTime', () => {
  it.each([
    [0, '00:00'],
    [5, '00:05'],
    [65, '01:05'],
    [3600, '01:00:00'],
    [3725.9, '01:02:05'],
  ])('formata %s segundos como %s', async (seconds, expected) => {
    const { formatTime } = await import('@/utils/formatTime')

    expect(formatTime(seconds)).toBe(expected)
  })

  it.each([[-1], [NaN], [undefined], [null], ['abc']])('devolve 00:00 para %s', async (value) => {
    const { formatTime } = await import('@/utils/formatTime')

    expect(formatTime(value)).toBe('00:00')
  })
})

describe('durationLabel — duração vinda do servidor', () => {
  it.each([
    ['00:00:00', ''],
    ['0:00', ''],
    ['', ''],
    [undefined, ''],
    ['01:42:10', '01:42:10'],
    ['45 min', '45 min'],
  ])('"%s" vira "%s" (zeros são o "não sei" do servidor)', async (text, expected) => {
    const { durationLabel } = await import('@/utils/formatTime')

    expect(durationLabel(text)).toBe(expected)
  })

  it('o filme sem duração conhecida não mostra 00:00:00 nos detalhes', async () => {
    const { normalizeVodInfo } = await import('@/services/xtreamApi')

    expect(normalizeVodInfo({ info: { duration: '00:00:00', duration_secs: 0 } }, {}).duration).toBe('')
    expect(normalizeVodInfo({ info: { duration: '00:00:00', duration_secs: 5400 } }, {}).duration).toBe('1h 30min')
  })
})
