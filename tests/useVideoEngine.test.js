import { describe, it, expect, vi } from 'vitest'

describe('useVideoEngine — diagnóstico sem vazar credenciais', () => {
  it('não imprime usuário e senha do formato alternativo no console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { useVideoEngine } = await import('@/composables/useVideoEngine')
    const engine = useVideoEngine()
    const video = document.createElement('video')

    await engine.attachAndPlay(video, {
      primaryUrl: 'http://srv.test/movie/usuario1/senha-secreta/1.mp4',
      fallbackUrl: 'http://srv.test/movie/usuario1/senha-secreta/1.m3u8',
      isHls: false,
      containerExtension: 'mp4',
    })
    video.dispatchEvent(new Event('error'))

    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).toContain('formato alternativo')
    expect(logged).not.toContain('senha-secreta')
    engine.destroyEngine()
  })

  it('mostra o motor e a URL mascarada quando a reprodução falha', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { useVideoEngine } = await import('@/composables/useVideoEngine')
    const engine = useVideoEngine()
    const video = document.createElement('video')

    await engine.attachAndPlay(video, {
      primaryUrl: 'http://srv.test/movie/usuario1/senha-secreta/1.mp4',
      fallbackUrl: null,
      isHls: false,
      containerExtension: 'mp4',
    })
    video.dispatchEvent(new Event('error'))

    expect(engine.error.value).not.toBe('')
    expect(engine.errorDetail.value).toContain('[Engine: native]')
    expect(engine.errorDetail.value).not.toContain('senha-secreta')
    engine.destroyEngine()
  })
})
