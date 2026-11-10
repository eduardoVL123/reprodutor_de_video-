import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const memory = new Map()
vi.mock('@/services/storage', async (importOriginal) => ({
  ...(await importOriginal()),
  storage: {
    get: async (k) => (memory.has(k) ? memory.get(k) : null),
    set: async (k, v) => void memory.set(k, v),
    remove: async (k) => void memory.delete(k),
  },
}))

const { default: DiagnosticsDialog } = await import('@/components/DiagnosticsDialog.vue')
const { recordError, resetErrorLogForTests } = await import('@/services/errorLog')
const { useLicenseStore } = await import('@/stores/licenseStore')

describe('Diagnóstico (plano de robustez, item 6)', () => {
  beforeEach(() => {
    memory.clear()
    resetErrorLogForTests()
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('mostra o código do aparelho e os erros sem a URL da lista; Limpar apaga; Fechar some', async () => {
    useLicenseStore().code = 'ABCD2345'
    await recordError(new Error('Falhou http://painel.tv/get.php?username=joao&password=x'), 'catálogo')
    const wrapper = mount(DiagnosticsDialog, { attachTo: document.body })
    await wrapper.vm.open()
    const text = document.getElementById('diagnostics-dialog').textContent
    expect(text).toContain('ABCD2345')
    expect(text).toContain('Falhou [endereço]')
    expect(text).not.toContain('joao')
    expect(document.activeElement.id).toBe('diag-close')

    document.getElementById('diag-clear').click()
    await vi.waitFor(() => expect(document.getElementById('diag-empty')).not.toBeNull())
    expect(memory.size).toBe(0)

    document.getElementById('diag-close').click()
    await vi.waitFor(() => expect(document.getElementById('diagnostics-dialog')).toBeNull())
    wrapper.unmount()
  })
})
