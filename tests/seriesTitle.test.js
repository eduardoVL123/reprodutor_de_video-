import { describe, it, expect } from 'vitest'
import { parseSeriesTitle } from '@/utils/seriesTitle'

describe('parseSeriesTitle — formatação de título de série e episódio', () => {
  it('separa série, temporada, episódio e nome do episódio a partir do padrão "Série - T2:E5 - Nome"', () => {
    const res = parseSeriesTitle('Maré Alta - T2:E5 - O Farol')
    expect(res).toEqual({
      header: 'Maré Alta · T2:E5',
      title: 'O Farol',
    })
  })

  it('reconhece padrão S02E05', () => {
    const res = parseSeriesTitle('Stranger Things S04E02 O Massacre no Laboratório de Hawkins')
    expect(res).toEqual({
      header: 'Stranger Things · T4:E2',
      title: 'O Massacre no Laboratório de Hawkins',
    })
  })

  it('quando não é série ou não tem padrão, devolve o título sem cabeçalho falso', () => {
    const res = parseSeriesTitle('O Poderoso Chefão')
    expect(res).toEqual({
      header: '',
      title: 'O Poderoso Chefão',
    })
  })

  it('lida com strings nulas ou vazias sem quebrar', () => {
    expect(parseSeriesTitle('')).toEqual({ header: '', title: '' })
    expect(parseSeriesTitle(null)).toEqual({ header: '', title: '' })
  })
})
