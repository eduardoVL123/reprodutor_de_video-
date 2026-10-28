/* Painel do serviço de licença (RFC-018 §4). Fala só com /admin/api/*; o token fica na aba (sessionStorage). */
;(function () {
  const TOKEN_KEY = 'pulse-license-token'
  const $ = (id) => document.getElementById(id)
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—')
  const fmtDay = (iso) => iso.split('-').reverse().join('/')
  const fmtMoney = (cents) => (cents == null ? 'Sob consulta' : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
  let partners = []

  function token() {
    try {
      return sessionStorage.getItem(TOKEN_KEY) || ''
    } catch (_) {
      return ''
    }
  }

  function say(text, isError) {
    $('message').textContent = text || ''
    $('message').className = isError ? 'error' : ''
  }

  async function api(method, path, body) {
    const res = await fetch(`/admin/api/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) showLogin()
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
    return data
  }

  /** Cria uma linha de tabela só com textContent (nada vira HTML). */
  function row(cells) {
    const tr = document.createElement('tr')
    for (const cell of cells) {
      const td = document.createElement('td')
      if (cell instanceof Node) td.appendChild(cell)
      else td.textContent = cell
      tr.appendChild(td)
    }
    return tr
  }

  function button(label, onClick) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'link'
    b.textContent = label
    b.addEventListener('click', onClick)
    return b
  }

  function showLogin() {
    document.querySelectorAll('.panel').forEach((p) => (p.hidden = true))
    $('login').hidden = false
  }

  function showTab(name) {
    $('login').hidden = true
    document.querySelectorAll('.panel').forEach((p) => (p.hidden = p.id !== name))
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name))
    say('')
    if (name === 'partners') loadPartners()
    if (name === 'report') loadReportPartners()
    if (name === 'devices') loadDeviceList(true)
    if (name === 'resellers') loadResellers()
    if (name === 'payments') loadPayments()
  }

  // Parceiros
  async function loadPartners() {
    try {
      partners = await api('GET', 'partners')
    } catch (err) {
      return say(err.message, true)
    }
    const tbody = $('partner-rows')
    tbody.textContent = ''
    for (const p of partners) {
      tbody.appendChild(row([p.name, fmtDay(p.startedOn), p.hosts.join(', '), p.active ? 'Ativa' : 'Encerrada', button('Editar', () => editPartner(p))]))
    }
  }

  function editPartner(p) {
    $('partner-form-title').textContent = p ? `Editar: ${p.name}` : 'Novo parceiro'
    $('partner-id').value = p ? p.id : ''
    $('partner-name').value = p ? p.name : ''
    $('partner-started').value = p ? p.startedOn : ''
    $('partner-hosts').value = p ? p.hosts.join('\n') : ''
    $('partner-active').checked = p ? p.active : true
  }

  $('partner-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const id = $('partner-id').value
    const body = {
      name: $('partner-name').value,
      startedOn: $('partner-started').value,
      active: $('partner-active').checked,
      hosts: $('partner-hosts').value.split(/\s+/).filter(Boolean),
    }
    try {
      await api(id ? 'PUT' : 'POST', id ? `partners/${id}` : 'partners', body)
      editPartner(null)
      say('Parceiro salvo.')
      loadPartners()
    } catch (err) {
      say(err.message, true)
    }
  })
  $('partner-cancel').addEventListener('click', () => editPartner(null))

  // Relatório
  async function loadReportPartners() {
    try {
      partners = await api('GET', 'partners')
    } catch (err) {
      return say(err.message, true)
    }
    const select = $('report-partner')
    select.textContent = ''
    for (const p of partners) select.appendChild(new Option(p.name, p.id))
    loadCycles()
  }

  async function loadCycles() {
    const id = $('report-partner').value
    $('cycle-rows').textContent = ''
    $('cycle-detail').hidden = true
    if (!id) return say('Cadastre um parceiro primeiro.')
    try {
      const cycles = await api('GET', `partners/${id}/cycles`)
      for (const c of cycles.slice().reverse()) {
        $('cycle-rows').appendChild(row([`${c.index + 1}`, fmtDay(c.start), fmtDay(c.end), String(c.actives), fmtMoney(c.amountCents), button('Abrir', () => openCycle(id, c.index))]))
      }
      if (!cycles.length) say('A parceria ainda não começou.')
    } catch (err) {
      say(err.message, true)
    }
  }
  $('report-partner').addEventListener('change', loadCycles)

  async function openCycle(id, index) {
    try {
      const cycle = await api('GET', `partners/${id}/cycles/${index}`)
      $('cycle-title').textContent = `Ciclo ${index + 1}: ${fmtDay(cycle.start)} a ${fmtDay(cycle.end)} — ${cycle.actives} ativos — ${fmtMoney(cycle.amountCents)}`
      $('device-rows').textContent = ''
      for (const d of cycle.devices) $('device-rows').appendChild(row([d.code, fmtDate(d.firstAt), fmtDate(d.lastAt), d.active ? 'Sim' : 'Não']))
      $('cycle-csv').dataset.path = `partners/${id}/cycles/${index}?format=csv`
      $('cycle-detail').hidden = false
    } catch (err) {
      say(err.message, true)
    }
  }

  // O CSV precisa do token no cabeçalho: baixa por fetch e entrega como arquivo.
  $('cycle-csv').addEventListener('click', async (e) => {
    e.preventDefault()
    const res = await fetch(`/admin/api/${e.currentTarget.dataset.path}`, { headers: { Authorization: `Bearer ${token()}` } })
    if (!res.ok) return say(`Erro ${res.status}`, true)
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(await res.blob())
    a.download = name ? name[1] : 'ativos.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  })

  // Aparelhos
  const STATUS_LABEL = { trial: 'Em teste', activated: 'Ativado', blocked: 'Bloqueado', expired: 'Sem acesso' }
  const PERIOD_LABEL = { '1m': '1 mês', '3m': '3 meses', '1y': '1 ano' }
  let currentCode = ''
  let devicePage = 0
  let searchTimer = null

  async function loadDeviceList(reset) {
    if (reset) {
      devicePage = 0
      $('device-list-rows').textContent = ''
    }
    const params = new URLSearchParams({ status: $('device-filter').value, q: $('device-search').value.trim(), page: String(devicePage) })
    try {
      const { items, nextPage } = await api('GET', `devices?${params}`)
      for (const d of items) {
        $('device-list-rows').appendChild(
          row([d.code, STATUS_LABEL[d.status] || d.status, d.platform, d.activationEndsAt ? fmtDate(d.activationEndsAt) : '—', d.note || '', button('Abrir', () => openDevice(d.code))]),
        )
      }
      devicePage = nextPage || 0
      $('device-more').hidden = nextPage == null
    } catch (err) {
      say(err.message, true)
    }
  }
  $('device-filter').addEventListener('change', () => loadDeviceList(true))
  $('device-search').addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => loadDeviceList(true), 300)
  })
  $('device-more').addEventListener('click', () => loadDeviceList(false))

  function listItems(el, lines) {
    el.textContent = ''
    for (const text of lines) {
      const li = document.createElement('li')
      li.textContent = text
      el.appendChild(li)
    }
  }

  function showDevice(info) {
    currentCode = info.code
    const dl = $('device-info')
    dl.textContent = ''
    const entries = [
      ['Código', info.code],
      ['Plataforma', info.platform],
      ['Situação', info.blockedAt ? `Bloqueado desde ${fmtDate(info.blockedAt)}` : 'Liberado para uso'],
      ['Primeiro acesso', fmtDate(info.firstSeenAt)],
      ['Teste até', fmtDate(info.trialEndsAt)],
      ['Ativado até', info.activationEndsAt ? fmtDate(info.activationEndsAt) : 'Sem ativação'],
    ]
    for (const [k, v] of entries) {
      const dt = document.createElement('dt')
      dt.textContent = k
      const dd = document.createElement('dd')
      dd.textContent = v
      dl.append(dt, dd)
    }
    $('device-note').value = info.note || ''
    listItems(
      $('activation-list'),
      (info.activations || []).map(
        (a) =>
          `${fmtDate(a.startsAt)} → ${fmtDate(a.endsAt)}${a.resellerId ? ` · revendedor #${a.resellerId}` : ''}${a.note ? ` · ${a.note}` : ''}${a.revokedAt ? ` · revogada em ${fmtDate(a.revokedAt)}` : ''}`,
      ),
    )
    listItems($('device-events'), (info.events || []).map((e) => `${fmtDate(e.at)} · ${e.action}${e.detail ? ` · ${e.detail}` : ''} · ${e.actor}`))
    $('device-detail').hidden = false
  }

  async function openDevice(code) {
    try {
      showDevice(await api('GET', `devices/${encodeURIComponent(code)}`))
      say('')
    } catch (err) {
      $('device-detail').hidden = true
      say(err.message, true)
    }
  }

  $('device-form').addEventListener('submit', (e) => {
    e.preventDefault()
    openDevice($('device-code').value.trim().toUpperCase())
  })

  /** Ação no aparelho aberto; o botão fica travado até a resposta (clique duplo não repete a ação). */
  async function deviceAction(btn, method, path, body, done) {
    if (btn.disabled) return
    btn.disabled = true
    try {
      const info = await api(method, `devices/${currentCode}${path}`, body)
      if (method === 'DELETE') {
        $('device-detail').hidden = true
        loadDeviceList(true)
      } else showDevice(info)
      say(done)
    } catch (err) {
      say(err.message, true)
    } finally {
      btn.disabled = false
    }
  }

  // Cada chamada soma o período: sem a trava, um clique duplo (ou impaciente) libera duas vezes por um pagamento.
  $('device-activate').addEventListener('click', (e) => {
    const period = $('activation-period').value
    const body = { note: $('activation-note').value }
    if (period === 'until') body.until = $('activation-until').value
    else body.period = period
    const label = period === 'until' ? `até ${body.until ? fmtDay(body.until) : '(escolha a data)'}` : `por mais ${PERIOD_LABEL[period]}`
    if (e.currentTarget.disabled || !confirm(`Liberar ${currentCode} ${label}?`)) return
    $('activation-note').value = ''
    deviceAction(e.currentTarget, 'POST', '/activate', body, 'Aparelho liberado.')
  })

  $('device-revoke').addEventListener('click', (e) => {
    if (!confirm(`Revogar a ativação de ${currentCode}?`)) return
    deviceAction(e.currentTarget, 'POST', '/revoke', {}, 'Ativação revogada.')
  })
  $('device-block').addEventListener('click', (e) => deviceAction(e.currentTarget, 'POST', '/block', {}, 'Aparelho bloqueado.'))
  $('device-unblock').addEventListener('click', (e) => deviceAction(e.currentTarget, 'POST', '/unblock', {}, 'Aparelho desbloqueado.'))
  $('device-trial').addEventListener('click', (e) =>
    deviceAction(e.currentTarget, 'POST', '/trial', { days: Number($('trial-days').value) }, 'Dias de teste adicionados.'),
  )
  $('device-note-save').addEventListener('click', (e) => deviceAction(e.currentTarget, 'POST', '/note', { note: $('device-note').value }, 'Observação salva.'))
  $('device-delete').addEventListener('click', (e) => {
    if (!confirm(`Apagar todos os dados de ${currentCode}? Se o app abrir de novo nele, volta como aparelho novo, com teste.`)) return
    deviceAction(e.currentTarget, 'DELETE', '', null, 'Dados do aparelho apagados.')
  })

  // Revendedores
  const MOVE_LABEL = {
    purchase: 'Compra',
    grant: 'Cortesia',
    refund: 'Estorno',
    activation: 'Ativação',
    transfer_in: 'Recebido da revenda acima',
    transfer_out: 'Repassado para revenda',
  }
  let resellers = []
  let currentReseller = null

  async function loadResellers() {
    try {
      resellers = await api('GET', 'resellers')
    } catch (err) {
      return say(err.message, true)
    }
    const byId = new Map(resellers.map((r) => [r.id, r]))
    $('reseller-rows').textContent = ''
    for (const r of resellers) {
      const parent = r.parentId ? (byId.get(r.parentId) || {}).name || `#${r.parentId}` : '—'
      $('reseller-rows').appendChild(row([r.name, parent, String(r.credits), r.active ? 'Ativa' : 'Bloqueada', `…${r.keyHint}`, button('Abrir', () => openReseller(r.id))]))
    }
    const select = $('reseller-parent')
    select.length = 1
    for (const r of resellers) select.appendChild(new Option(r.name, r.id))
  }

  function showKey(name, key) {
    $('reseller-key').textContent = `Chave de ${name} (aparece só agora, copie e entregue): ${key}`
  }

  $('reseller-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const parentId = $('reseller-parent').value
    const body = { name: $('reseller-name').value, contact: $('reseller-contact').value, parentId: parentId ? Number(parentId) : null }
    try {
      const created = await api('POST', 'resellers', body)
      showKey(body.name, created.key)
      $('reseller-name').value = ''
      $('reseller-contact').value = ''
      say('Revendedor criado.')
      loadResellers()
    } catch (err) {
      say(err.message, true)
    }
  })

  async function openReseller(id) {
    currentReseller = resellers.find((r) => r.id === id) || null
    if (!currentReseller) return
    $('reseller-title').textContent = `${currentReseller.name} — ${currentReseller.credits} créditos`
    $('reseller-toggle').textContent = currentReseller.active ? 'Bloquear' : 'Desbloquear'
    $('reseller-detail').hidden = false
    try {
      const moves = await api('GET', `resellers/${id}/movements`)
      $('movement-rows').textContent = ''
      for (const m of moves) {
        const detail = m.deviceCode || (m.counterpartId ? `revenda #${m.counterpartId}` : '') || m.note
        const value = m.amountCents == null ? '—' : fmtMoney(m.amountCents)
        $('movement-rows').appendChild(row([fmtDate(m.createdAt), MOVE_LABEL[m.kind] || m.kind, (m.delta > 0 ? '+' : '') + m.delta, value, detail || '']))
      }
    } catch (err) {
      say(err.message, true)
    }
  }

  $('credit-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const value = $('credit-value').value
    const body = { amount: Number($('credit-amount').value), kind: $('credit-kind').value, note: $('credit-note').value }
    if (value !== '') body.amountCents = Math.round(Number(value) * 100)
    try {
      await api('POST', `resellers/${currentReseller.id}/credits`, body)
      $('credit-amount').value = ''
      $('credit-value').value = ''
      $('credit-note').value = ''
      say('Créditos lançados.')
      await loadResellers()
      openReseller(currentReseller.id)
    } catch (err) {
      say(err.message, true)
    }
  })

  $('reseller-toggle').addEventListener('click', async () => {
    try {
      await api('POST', `resellers/${currentReseller.id}/active`, { active: !currentReseller.active })
      await loadResellers()
      openReseller(currentReseller.id)
    } catch (err) {
      say(err.message, true)
    }
  })

  $('reseller-rotate').addEventListener('click', async () => {
    if (!confirm(`Trocar a chave de ${currentReseller.name}? A chave atual para de funcionar na hora.`)) return
    try {
      showKey(currentReseller.name, (await api('POST', `resellers/${currentReseller.id}/key`, {})).key)
    } catch (err) {
      say(err.message, true)
    }
  })

  // Pagamentos pelo Mercado Pago (RFC-020): pedidos e assinaturas no cartão
  const ORDER_STATUS = {
    pending: 'Aguardando pagamento',
    paid: 'Pago, sem entrega',
    delivering: 'Entregando',
    delivered: 'Entregue',
    expired: 'Expirado',
    failed: 'Recusado ou falhou',
  }
  const SUBSCRIPTION_STATUS = { pending: 'Aguardando 1ª cobrança', authorized: 'Ativa', paused: 'Pausada', cancelled: 'Cancelada' }
  const PAY_METHOD = { pix: 'Pix', card: 'Cartão' }
  // Pago sem entrega: entrega agora; pendente/expirado: pergunta ao Mercado Pago (webhook perdido).
  const REPROCESSABLE = ['paid', 'pending', 'expired']

  function orderWhat(o) {
    if (o.kind === 'device_annual') return `Aparelho ${o.deviceCode}`
    return `${o.quantity} créditos — ${o.buyerName ? `${o.buyerName} (${o.buyerContact})` : `revenda #${o.resellerId}`}`
  }

  async function loadPayments() {
    const filter = $('order-filter').value
    let orders
    let subscriptions
    try {
      ;[orders, subscriptions] = await Promise.all([api('GET', `orders${filter ? `?status=${filter}` : ''}`), api('GET', 'subscriptions')])
    } catch (err) {
      return say(err.message, true)
    }
    $('order-rows').textContent = ''
    for (const o of orders) {
      const action = REPROCESSABLE.includes(o.status) ? button('Reprocessar', (e) => reprocess(e.currentTarget, o)) : ''
      $('order-rows').appendChild(row([fmtDate(o.createdAt), orderWhat(o), PAY_METHOD[o.method] || o.method, fmtMoney(o.amountCents), ORDER_STATUS[o.status] || o.status, action]))
    }
    $('subscription-rows').textContent = ''
    for (const s of subscriptions) {
      const action = s.status === 'cancelled' ? '' : button('Cancelar renovação', (e) => cancelRenewal(e.currentTarget, s))
      $('subscription-rows').appendChild(row([fmtDate(s.createdAt), s.deviceCode, SUBSCRIPTION_STATUS[s.status] || s.status, action]))
    }
  }

  async function reprocess(btn, o) {
    btn.disabled = true
    try {
      const fresh = await api('POST', `orders/${o.id}/reprocess`, {})
      say(fresh.status === 'delivered' ? 'Pedido entregue.' : `Situação no Mercado Pago: ${ORDER_STATUS[fresh.status] || fresh.status}.`)
      loadPayments()
    } catch (err) {
      say(err.message, true)
      btn.disabled = false
    }
  }

  async function cancelRenewal(btn, s) {
    if (!confirm(`Cancelar a renovação automática do aparelho ${s.deviceCode}? O que já foi pago continua valendo.`)) return
    btn.disabled = true
    try {
      await api('POST', `subscriptions/${s.id}/cancel`, {})
      say('Renovação cancelada no Mercado Pago.')
      loadPayments()
    } catch (err) {
      say(err.message, true)
      btn.disabled = false
    }
  }

  $('order-filter').addEventListener('change', loadPayments)

  // Entrada e abas
  $('login-form').addEventListener('submit', (e) => {
    e.preventDefault()
    try {
      sessionStorage.setItem(TOKEN_KEY, $('token').value)
    } catch (_) {}
    $('token').value = ''
    showTab('partners')
  })
  $('logout').addEventListener('click', () => {
    try {
      sessionStorage.removeItem(TOKEN_KEY)
    } catch (_) {}
    showLogin()
  })
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => (token() ? showTab(t.dataset.tab) : showLogin())))

  if (token()) showTab('partners')
  else showLogin()
})()
