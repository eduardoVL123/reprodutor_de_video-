/** Formata segundos como "mm:ss" ou "hh:mm:ss" ("00:00" para valores inválidos). */
export function formatTime(sec) {
  if (!sec || isNaN(sec) || sec < 0) return '00:00'
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const remS = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(remS)}` : `${pad(m)}:${pad(remS)}`
}

/** Duração em texto vinda do servidor; só zeros ("00:00:00") é o "não sei" dele e vira ''. */
export function durationLabel(text) {
  return /[1-9]/.test(String(text || '')) ? String(text) : ''
}
