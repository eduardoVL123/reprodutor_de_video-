/* Painel do revendedor (RFC-022): só interface sobre a API /api/v1/* (RFC-019); a chave fica na aba (sessionStorage). */
;(function () {
  const KEY = 'pulse-reseller-key'
  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const SOON_MS = 30 * 24 * 3600 * 1000
  const $ = (id) => document.getElementById(id)
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—')
  const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const MOVE_LABEL = {
    purchase: 'Compra',
    grant: 'Cortesia',
    refund: 'Estorno',
    activation: 'Ativação',
    transfer_in: 'Recebido',
    transfer_out: 'Passado para revenda',
  }
  let me = null
  let config = null
  let clients = []
  let subs = []
  let currentSub = null

  function key() {
    try {
      return sessionStorage.getItem(KEY) || ''
    } catch (_) {
      return ''
    }
  }

  function setKey(value) {
    try {
      if (value) sessionStorage.setItem(KEY, value)
      else sessionStorage.removeItem(KEY)
    } catch (_) {}
  }

  function say(id, text, ok) {
    $(id).textContent = text || ''
    $(id).className = ok ? 'ok' : 'error'
  }

  /** Uma chave por operação: refazer a mesma chamada (rede caiu, clique duplo) não gasta crédito de novo. */
  function idempotencyKey() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  async function api(method, path, body, idem) {
    const headers = { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' }
    if (idem) headers['Idempotency-Key'] = idem
    const res = await fetch(`/api/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) showLogin()
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
    return data
  }

  function normalizeCode(text) {
    let out = ''
    for (const ch of String(text || '').toUpperCase()) if (CODE_ALPHABET.includes(ch) && out.length < 8) out += ch
    return out
  }

  function cells(tr, values) {
    for (const v of values) {
      const td = document.createElement('td')
      if (v instanceof Node) td.appendChild(v)
      else td.textContent = v
      tr.appendChild(td)
    }
    return tr
  }

  function button(label, onClick, className = 'link') {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = className
    b.textContent = label
    b.addEventListener('click', onClick)
    return b
  }

  function whatsapp(message) {
    if (!config || !config.contactUrl) return ''
    return `${config.contactUrl}${config.contactUrl.includes('?') ? '&' : '?'}text=${encodeURIComponent(message)}`
  }

  function showLogin() {
    $('app').hidden = true
    $('logout').hidden = true
    $('login').hidden = false
  }

  // Dados
  async function loadMe() {
    me = await api('GET', 'me')
    $('reseller-name').textContent = me.name
    $('balance').textContent = String(me.credits)
  }

  function renderClients() {
    const q = normalizeCode($('client-search').value)
    $('client-rows').textContent = ''
    const now = Date.now()
    for (const c of clients.filter((x) => !q || x.code.includes(q))) {
      const tr = cells(document.createElement('tr'), [c.code, fmtDate(c.startsAt), c.revokedAt ? 'Revogada' : fmtDate(c.endsAt), button('Renovar', () => renew(c.code))])
      if (!c.revokedAt && c.endsAt - now < SOON_MS) tr.className = 'soon' // vence em até 30 dias
      $('client-rows').appendChild(tr)
    }
  }

  async function loadClients(more) {
    const before = more && clients.length ? `?before=${clients[clients.length - 1].id}` : ''
    const page = await api('GET', `activations${before}`)
    clients = more ? clients.concat(page) : page
    $('client-more').hidden = page.length < 50
    renderClients()
  }

  async function loadSubs() {
    subs = await api('GET', 'sub-resellers')
    $('sub-rows').textContent = ''
    for (const s of subs) {
      $('sub-rows').appendChild(
        cells(document.createElement('tr'), [s.name, s.contact || '', String(s.credits), button('Passar créditos', () => pickSub(s)), button('Trocar chave', () => rotateSub(s))]),
      )
    }
  }

  async function loadMovements() {
    const moves = await api('GET', 'movements')
    $('movement-rows').textContent = ''
    for (const m of moves) {
      const detail = m.deviceCode || (m.counterpartId ? `revenda #${m.counterpartId}` : '') || m.note || ''
      $('movement-rows').appendChild(cells(document.createElement('tr'), [fmtDate(m.createdAt), MOVE_LABEL[m.kind] || m.kind, (m.delta > 0 ? '+' : '') + m.delta, detail]))
    }
  }

  async function loadConfig() {
    try {
      config = await (await fetch('/v1/site-config')).json()
    } catch (_) {
      config = null
    }
    if (!config) return
    if (config.contactUrl) {
      $('support-link').href = whatsapp('Olá! Perdi a chave do meu painel de revenda do Pulse Player.')
      $('support-link').hidden = false
    }
    const rows = config.creditTiers.slice().reverse()
    $('tier-rows').textContent = ''
    rows.forEach(([min, cents], i) => {
      const next = rows[i + 1]
      $('tier-rows').appendChild(cells(document.createElement('tr'), [next ? `${min} a ${next[0] - 1}` : `${min} ou mais`, brl(cents)]))
    })
    updateTotal()
  }

  async function loadAll() {
    try {
      await loadMe()
      $('login').hidden = true
      $('app').hidden = false
      $('logout').hidden = false
      say('message', '', true)
      await Promise.all([loadClients(false), loadSubs(), loadMovements()])
    } catch (err) {
      say('message', err.message)
    }
  }

  // Ativar TV
  async function activate(e) {
    e.preventDefault()
    const code = normalizeCode($('activate-code').value)
    if (code.length !== 8) return say('activate-status', 'Digite os 8 caracteres do código que aparece na TV.')
    if (!confirm(`Ativar o aparelho ${code} por 1 ano usando 1 crédito?`)) return
    const btn = $('activate-button')
    btn.disabled = true
    try {
      const result = await api('POST', 'activations', { code }, idempotencyKey())
      say('activate-status', `Ativado até ${fmtDate(result.activationEndsAt)}. Na TV, toque em "Já paguei, verificar".`, true)
      $('activate-code').value = ''
      $('balance').textContent = String(result.credits)
      await Promise.all([loadClients(false), loadMovements()])
    } catch (err) {
      say('activate-status', err.message)
    } finally {
      btn.disabled = false
    }
  }

  function renew(code) {
    $('activate-code').value = code
    $('activate-form').dispatchEvent(new Event('submit', { cancelable: true }))
  }

  // Revendas
  function pickSub(s) {
    currentSub = s
    $('transfer-title').textContent = `Passar créditos para ${s.name}`
    $('transfer-form').hidden = false
  }

  async function transfer(e) {
    e.preventDefault()
    const amount = Number($('transfer-amount').value)
    if (!currentSub) return
    try {
      const result = await api('POST', `sub-resellers/${currentSub.id}/credits`, { amount }, idempotencyKey())
      $('balance').textContent = String(result.credits)
      $('transfer-amount').value = ''
      $('transfer-form').hidden = true
      say('message', `${amount} créditos passados para ${currentSub.name}.`, true)
      await Promise.all([loadSubs(), loadMovements()])
    } catch (err) {
      say('message', err.message)
    }
  }

  async function createSub(e) {
    e.preventDefault()
    const name = $('sub-name').value.trim()
    try {
      const created = await api('POST', 'sub-resellers', { name, contact: $('sub-contact').value.trim() })
      $('sub-key').textContent = `Chave de ${name} (copie agora, ela aparece só esta vez): ${created.key}`
      $('sub-name').value = ''
      $('sub-contact').value = ''
      await loadSubs()
    } catch (err) {
      say('message', err.message)
    }
  }

  async function rotateSub(s) {
    if (!confirm(`Trocar a chave de ${s.name}? A atual para de funcionar na hora.`)) return
    try {
      const { key: fresh } = await api('POST', `sub-resellers/${s.id}/key`, {})
      $('sub-key').textContent = `Nova chave de ${s.name} (copie agora): ${fresh}`
    } catch (err) {
      say('message', err.message)
    }
  }

  // Comprar créditos (pelo WhatsApp até o Pix da RFC-020)
  function updateTotal() {
    if (!config) return null
    const qty = Number($('buy-qty').value)
    if (!Number.isInteger(qty) || qty < config.minCredits) {
      $('buy-total').textContent = `Compre no mínimo ${config.minCredits} créditos.`
      return null
    }
    const unit = config.creditTiers.find(([min]) => qty >= min)[1]
    $('buy-total').textContent = `Total: ${brl(unit * qty)} (${qty} × ${brl(unit)})`
    return { qty, total: unit * qty }
  }

  function buy(e) {
    e.preventDefault()
    const order = updateTotal()
    if (!order) return
    const link = whatsapp(`Quero comprar ${order.qty} créditos do Pulse Player (total ${brl(order.total)}). Revenda: ${me ? me.name : ''} (#${me ? me.id : ''}).`)
    if (!link) return say('message', 'Atendimento indisponível no momento.')
    $('buy-whatsapp').href = link
    $('buy-whatsapp').hidden = false
  }

  // Minha chave
  async function rotateMine() {
    if (!confirm('Trocar a sua chave? A atual para de funcionar na hora, inclusive em painéis de outros sistemas.')) return
    try {
      const { key: fresh } = await api('POST', 'me/key', {})
      setKey(fresh)
      $('my-key').textContent = `Sua nova chave (copie agora, ela aparece só esta vez): ${fresh}`
    } catch (err) {
      say('message', err.message)
    }
  }

  $('login-form').addEventListener('submit', (e) => {
    e.preventDefault()
    setKey($('key').value.trim())
    $('key').value = ''
    loadAll()
  })
  $('logout').addEventListener('click', () => {
    setKey('')
    showLogin()
  })
  $('activate-form').addEventListener('submit', activate)
  $('client-search').addEventListener('input', renderClients)
  $('client-more').addEventListener('click', () => loadClients(true))
  $('transfer-form').addEventListener('submit', transfer)
  $('sub-form').addEventListener('submit', createSub)
  $('buy-qty').addEventListener('input', updateTotal)
  $('buy-form').addEventListener('submit', buy)
  $('rotate-key').addEventListener('click', rotateMine)

  loadConfig()
  if (key()) loadAll()
  else showLogin()
})()
