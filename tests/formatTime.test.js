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
