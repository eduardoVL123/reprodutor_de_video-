import qrcode from 'qrcode-generator'

/**
 * QR code como dados para um <svg> inline (sem imagem externa, só um <path>): um quadrado de 1×1 por módulo escuro,
 * em coordenadas de módulo (0 a size-1). A margem em volta (4 módulos, exigida pelo padrão QR) fica por conta de
 * quem desenha, via viewBox. Correção de erro M: aguenta um pouco de reflexo e de sujeira na tela da TV.
 * Lança erro com texto vazio ou grande demais (mais de ~2300 bytes).
 * @returns {{ size: number, path: string }}
 */
export function qrSvgData(text) {
  if (!text) throw new Error('QR sem texto')
  const qr = qrcode(0, 'M') // 0 = versão automática, a menor que couber
  qr.addData(text)
  qr.make()
  const size = qr.getModuleCount()
  let path = ''
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (qr.isDark(y, x)) path += `M${x} ${y}h1v1h-1z`
    }
  }
  return { size, path }
}
