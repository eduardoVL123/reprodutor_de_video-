import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

const ADMIN_DIR = 'server/license/public/admin/'
const DEVICE = { code: 'ABCD2345', platform: 'tizen', firstSeenAt: 1, trialEndsAt: 2, activationEndsAt: null, activations: [] }

/** Monta a página do painel no jsdom e executa o admin.js como o navegador faria. */
function openPanel(fetchMock) {
  const html = readFileSync(`${ADMIN_DIR}index.html`, 'utf8')
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[^>]*><\/script>/g, '')
  sessionStorage.setItem('pulse-license-token', 'segredo')
  // Ao abrir com token o painel lista os parceiros; o mock do teste só trata os aparelhos.
  vi.stubGlobal('fetch', (url, init) => (String(url).includes('/partners') ? Promise.resolve(reply([])) : fetchMock(url, init)))
  new Function(readFileSync(`${ADMIN_DIR}admin.js`, 'utf8'))()
}

const reply = (body) => ({ ok: true, status: 200, json: async () => body })

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('painel — Liberar 1 ano', () => {
  async function openDevice(fetchMock) {
    openPanel(fetchMock)
    document.getElementById('device-code').value = DEVICE.code
    document.getElementById('device-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(document.getElementById('device-detail').hidden).toBe(false))
  }

  it('clique duplo envia uma só ativação', async () => {
    let finish
    const fetchMock = vi.fn((url, init) => {
      if (init.method === 'POST') return new Promise((resolve) => (finish = () => resolve(reply({ ...DEVICE, activationEndsAt: 9 }))))
      return Promise.resolve(reply(DEVICE))
    })
    await openDevice(fetchMock)
    const button = document.getElementById('device-activate')

    button.click()
    button.click()
    finish()
    await vi.waitFor(() => expect(button.disabled).toBe(false))

    const posts = fetchMock.mock.calls.filter(([, init]) => init.method === 'POST')
    expect(posts).toHaveLength(1)
  })

  it('não ativa se o operador cancelar a confirmação', async () => {
    window.confirm.mockReturnValue(false)
    const fetchMock = vi.fn(async () => reply(DEVICE))
    await openDevice(fetchMock)

    document.getElementById('device-activate').click()

    expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(0)
  })
})

/** RFC-019: controle de acessos e revendedores no painel do dono. */
const posted = (fetchMock, method = 'POST') =>
  fetchMock.mock.calls.filter(([, init]) => init && init.method === method).map(([url, init]) => [String(url), init.body ? JSON.parse(init.body) : null])

describe('painel — ações no aparelho (RFC-019)', () => {
  async function openDeviceRfc19(fetchMock) {
    openPanel(fetchMock)
    document.getElementById('device-code').value = DEVICE.code
    document.getElementById('device-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(document.getElementById('device-detail').hidden).toBe(false))
  }

  it('libera pelo período escolhido (3 meses)', async () => {
    const fetchMock = vi.fn(async () => reply(DEVICE))
    await openDeviceRfc19(fetchMock)
    document.getElementById('activation-period').value = '3m'
    document.getElementById('device-activate').click()
    await vi.waitFor(() => expect(posted(fetchMock)).toHaveLength(1))
    expect(posted(fetchMock)[0]).toEqual([`/admin/api/devices/${DEVICE.code}/activate`, expect.objectContaining({ period: '3m' })])
  })

  it('bloqueia, dá dias de teste e salva a observação', async () => {
    const fetchMock = vi.fn(async () => reply(DEVICE))
    await openDeviceRfc19(fetchMock)
    document.getElementById('device-block').click()
    document.getElementById('trial-days').value = '5'
    document.getElementById('device-trial').click()
    document.getElementById('device-note').value = 'Cliente Ana'
    document.getElementById('device-note-save').click()
    await vi.waitFor(() => expect(posted(fetchMock)).toHaveLength(3))
    expect(posted(fetchMock)).toEqual([
      [`/admin/api/devices/${DEVICE.code}/block`, {}],
      [`/admin/api/devices/${DEVICE.code}/trial`, { days: 5 }],
      [`/admin/api/devices/${DEVICE.code}/note`, { note: 'Cliente Ana' }],
    ])
  })

  it('apagar os dados pede confirmação e usa DELETE', async () => {
    const fetchMock = vi.fn(async () => reply(DEVICE))
    await openDeviceRfc19(fetchMock)
    document.getElementById('device-delete').click()
    await vi.waitFor(() => expect(posted(fetchMock, 'DELETE')).toHaveLength(1))
    expect(window.confirm).toHaveBeenCalled()
  })

  it('a lista de aparelhos usa o filtro escolhido', async () => {
    const fetchMock = vi.fn(async () => reply({ items: [{ ...DEVICE, status: 'blocked', note: '' }], nextPage: null }))
    openPanel(fetchMock)
    document.querySelector('[data-tab="devices"]').click()
    document.getElementById('device-filter').value = 'blocked'
    document.getElementById('device-filter').dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(document.getElementById('device-list-rows').textContent).toContain(DEVICE.code))
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('devices?status=blocked'))).toBe(true)
  })
})

describe('painel — revendedores (RFC-019)', () => {
  it('cria revendedor e mostra a chave uma vez', async () => {
    const fetchMock = vi.fn(async (url, init) =>
      init && init.method === 'POST' ? { ok: true, status: 201, json: async () => ({ id: 7, key: 'pk_chave-nova' }) } : reply([]),
    )
    openPanel(fetchMock)
    document.querySelector('[data-tab="resellers"]').click()
    document.getElementById('reseller-name').value = 'Loja Nova'
    document.getElementById('reseller-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(document.getElementById('reseller-key').textContent).toContain('pk_chave-nova'))
    expect(posted(fetchMock)[0]).toEqual(['/admin/api/resellers', expect.objectContaining({ name: 'Loja Nova' })])
  })

  it('lança créditos com quantidade e tipo', async () => {
    const R = { id: 3, parentId: null, name: 'Loja', contact: '', credits: 0, active: true, keyHint: 'abcd' }
    const fetchMock = vi.fn(async (url, init) => (init && init.method === 'POST' ? reply({ ...R, credits: 20 }) : reply(String(url).includes('movements') ? [] : [R])))
    openPanel(fetchMock)
    document.querySelector('[data-tab="resellers"]').click()
    await vi.waitFor(() => expect(document.getElementById('reseller-rows').textContent).toContain('Loja'))
    document.querySelector('#reseller-rows button').click()
    document.getElementById('credit-amount').value = '20'
    document.getElementById('credit-kind').value = 'purchase'
    document.getElementById('credit-form').dispatchEvent(new Event('submit', { cancelable: true }))
    await vi.waitFor(() => expect(posted(fetchMock)).toHaveLength(1))
    expect(posted(fetchMock)[0]).toEqual(['/admin/api/resellers/3/credits', expect.objectContaining({ amount: 20, kind: 'purchase' })])
  })
})

/** RFC-020 etapa 6: pedidos do Mercado Pago e assinaturas no cartão no painel do dono. */
describe('painel — pagamentos (RFC-020)', () => {
  const ORDERS = [
    { id: 'o'.repeat(22), kind: 'credits', method: 'pix', status: 'paid', amountCents: 18000, quantity: 20, deviceCode: null, buyerName: 'Loja do Zé', buyerContact: '16 9999', createdAt: 1, paidAt: 2, delivery: null },
    { id: 'p'.repeat(22), kind: 'device_annual', method: 'card', status: 'delivered', amountCents: 2500, quantity: 1, deviceCode: 'ABCD2345', buyerName: null, buyerContact: null, createdAt: 1, paidAt: 2, delivery: { activationEndsAt: 3 } },
  ]
  const SUBS = [
    { id: 's'.repeat(22), deviceCode: 'ABCD2345', status: 'authorized', mpPreapprovalId: 'pre-1', createdAt: 1, cancelledAt: null },
    { id: 't'.repeat(22), deviceCode: 'WXYZ6789', status: 'cancelled', mpPreapprovalId: 'pre-2', createdAt: 1, cancelledAt: 2 },
  ]

  async function openPayments(fetchMock) {
    openPanel(fetchMock)
    document.querySelector('[data-tab="payments"]').click()
    await vi.waitFor(() => expect(document.getElementById('order-rows').children).toHaveLength(2))
    await vi.waitFor(() => expect(document.getElementById('subscription-rows').children).toHaveLength(2))
  }

  const mock = () =>
    vi.fn(async (url, init = {}) => {
      if (init.method === 'POST') return reply({ status: String(url).includes('cancel') ? 'cancelled' : 'delivered' })
      if (String(url).includes('/subscriptions')) return reply(SUBS)
      return reply(ORDERS)
    })

  it('lista pedidos e assinaturas com o que foi comprado, o meio, o valor e a situação', async () => {
    await openPayments(mock())
    const orders = document.getElementById('order-rows').textContent
    expect(orders).toContain('20 créditos — Loja do Zé (16 9999)')
    expect(orders).toContain('Aparelho ABCD2345')
    expect(orders).toMatch(/Pix.*R\$\s?180,00.*Pago, sem entrega/)
    expect(orders).toMatch(/Cartão.*Entregue/)
    const subs = document.getElementById('subscription-rows').textContent
    expect(subs).toMatch(/ABCD2345.*Ativa/)
    expect(subs).toMatch(/WXYZ6789.*Cancelada/)
  })

  it('reprocessar só aparece onde faz sentido e chama a API do pedido', async () => {
    const fetchMock = mock()
    await openPayments(fetchMock)
    const buttons = [...document.getElementById('order-rows').querySelectorAll('button')]
    expect(buttons.map((b) => b.textContent)).toEqual(['Reprocessar'])
    buttons[0].click()
    await vi.waitFor(() => expect(posted(fetchMock)).toHaveLength(1))
    expect(posted(fetchMock)[0][0]).toBe(`/admin/api/orders/${'o'.repeat(22)}/reprocess`)
  })

  it('o filtro de situação vai para a API', async () => {
    const fetchMock = mock()
    await openPayments(fetchMock)
    const filter = document.getElementById('order-filter')
    filter.value = 'paid'
    filter.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/admin/api/orders?status=paid'))).toBe(true))
  })

  it('cancelar a renovação pede confirmação; sem confirmar, nada é enviado', async () => {
    const fetchMock = mock()
    await openPayments(fetchMock)
    const cancel = [...document.getElementById('subscription-rows').querySelectorAll('button')]
    expect(cancel.map((b) => b.textContent)).toEqual(['Cancelar renovação'])
    window.confirm.mockReturnValue(false)
    cancel[0].click()
    expect(posted(fetchMock)).toHaveLength(0)
    window.confirm.mockReturnValue(true)
    cancel[0].click()
    await vi.waitFor(() => expect(posted(fetchMock)).toHaveLength(1))
    expect(posted(fetchMock)[0][0]).toBe(`/admin/api/subscriptions/${'s'.repeat(22)}/cancel`)
  })
})
