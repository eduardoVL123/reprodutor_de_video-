/**
 * Deslocamento horizontal (px, ≤ 0) de uma fileira deslizante para o item focado ficar na posição
 * inicial, sem sobrar espaço vazio no fim. Medidas inválidas (antes do layout) → 0.
 * @param {{ index:number, itemSize:number, gap:number, count:number, viewport:number }} m
 */
export function railOffset({ index, itemSize, gap, count, viewport }) {
  if (!(itemSize > 0) || !(viewport > 0) || !(count > 0) || !(index > 0)) return 0
  const total = count * itemSize + (count - 1) * gap
  const maxShift = Math.max(0, total - viewport)
  const shift = Math.min(index * (itemSize + gap), maxShift)
  return shift > 0 ? -shift : 0
}
