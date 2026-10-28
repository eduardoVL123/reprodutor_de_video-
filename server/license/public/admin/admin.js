/* Painel do serviço de licença (RFC-018 §4). Fala só com /admin/api/*; o token fica na aba (sessionStorage). */
;(function () {
  const TOKEN_KEY = 'pulse-license-token'
  const $ = (id) => document.getElementById(id)
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—')
  const fmtDay = (iso) => iso.split('-').reverse().join('/')
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
        $('cycle-rows').appendChild(row([`${c.index + 1}`, fmtDay(c.start), fmtDay(c.end), String(c.actives), button('Abrir', () => openCycle(id, c.index))]))
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
      $('cycle-title').textContent = `Ciclo ${index + 1}: ${fmtDay(cycle.start)} a ${fmtDay(cycle.end)} — ${cycle.actives} ativos`
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
  let currentCode = ''

  function showDevice(info) {
    currentCode = info.code
    const dl = $('device-info')
    dl.textContent = ''
    const entries = [
      ['Código', info.code],
      ['Plataforma', info.platform],
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
    const list = $('activation-list')
    list.textContent = ''
    for (const a of info.activations) {
      const li = document.createElement('li')
      li.textContent = `${fmtDate(a.startsAt)} → ${fmtDate(a.endsAt)}${a.note ? ` · ${a.note}` : ''}${a.revokedAt ? ` · revogada em ${fmtDate(a.revokedAt)}` : ''}`
      list.appendChild(li)
    }
    $('device-detail').hidden = false
  }

  $('device-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    try {
      showDevice(await api('GET', `devices/${encodeURIComponent($('device-code').value.trim().toUpperCase())}`))
      say('')
    } catch (err) {
      $('device-detail').hidden = true
      say(err.message, true)
    }
  })

  $('device-activate').addEventListener('click', async () => {
    try {
      showDevice(await api('POST', `devices/${currentCode}/activate`, { note: $('activation-note').value }))
      $('activation-note').value = ''
      say('Aparelho liberado por mais 1 ano.')
    } catch (err) {
      say(err.message, true)
    }
  })

  $('device-revoke').addEventListener('click', async () => {
    if (!confirm(`Revogar a ativação de ${currentCode}?`)) return
    try {
      showDevice(await api('POST', `devices/${currentCode}/revoke`, {}))
      say('Ativação revogada.')
    } catch (err) {
      say(err.message, true)
    }
  })

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
