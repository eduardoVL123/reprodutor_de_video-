/**
 * Analisa o nome do item para separar título da série / temporada / episódio e nome do episódio.
 * Usado pelo Player 2.0 (RFC-014): "Maré Alta · T2:E5" acima, "O Farol" abaixo.
 *
 * @param {string} rawName
 * @returns {{ header: string, title: string }}
 */
export function parseSeriesTitle(rawName) {
  if (!rawName || typeof rawName !== 'string') {
    return { header: '', title: '' }
  }

  const trimmed = rawName.trim()

  // Padrão 1: "Série - T2:E5 - Título do episódio" ou "Série - T02:E05 - Título"
  const dashMatch = trimmed.match(/^(.+?)\s*-\s*T(\d+):E(\d+)\s*-\s*(.+)$/i)
  if (dashMatch) {
    const [, series, season, ep, epTitle] = dashMatch
    return {
      header: `${series.trim()} · T${parseInt(season, 10)}:E${parseInt(ep, 10)}`,
      title: epTitle.trim(),
    }
  }

  // Padrão 2: "Série S02E05 Título" ou "Série - S02E05 - Título"
  const sxMatch = trimmed.match(/^(.+?)(?:\s*-)?\s*S(\d+)E(\d+)(?:\s*-)?\s*(.+)$/i)
  if (sxMatch) {
    const [, series, season, ep, epTitle] = sxMatch
    return {
      header: `${series.trim()} · T${parseInt(season, 10)}:E${parseInt(ep, 10)}`,
      title: epTitle.trim(),
    }
  }

  return {
    header: '',
    title: trimmed,
  }
}
