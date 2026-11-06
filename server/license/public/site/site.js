/* Site do Pulse Player (RFC-021/025): landing de venda, Minha TV, enviar lista cifrada para a TV, assinar o aparelho e comprar créditos (pagamento em /pagar). */
;(function () {
  const $ = (id) => document.getElementById(id)
  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // igual ao serviço de licença (sem 0/O/1/I/L)
  const CODE_LENGTH = 8
  const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  let config = null

  function setupLegalNotice() {
    const dialog = $('legal-notice')
    if (!dialog || location.pathname !== '/') return
    const key = 'pulse:legal-notice:v1'
    try {
      if (localStorage.getItem(key) === 'dismissed') return
    } catch (_) { /* Navegação privada pode bloquear o armazenamento. */ }
    dialog.addEventListener('close', () => {
      if (!$('legal-remember').checked) return
      try { localStorage.setItem(key, 'dismissed') } catch (_) { /* Continua funcionando sem persistência. */ }
    })
    dialog.showModal()
  }

  /** Código do aparelho como aparece na TV: maiúsculas, só o alfabeto do serviço, 8 caracteres. */
  function normalizeCode(text) {
    let out = ''
    for (const ch of String(text || '').toUpperCase()) {
      if (CODE_ALPHABET.includes(ch) && out.length < CODE_LENGTH) out += ch
    }
    return out
  }

  function status(id, text, ok) {
    $(id).textContent = text
    $(id).className = ok ? 'ok' : 'error'
  }

  /** Link do WhatsApp com a mensagem pronta (o número vem da configuração do serviço). */
  function whatsapp(message) {
    if (!config || !config.contactUrl) return ''
    return `${config.contactUrl}${config.contactUrl.includes('?') ? '&' : '?'}text=${encodeURIComponent(message)}`
  }

  async function readJson(res) {
    try {
      return await res.json()
    } catch (_) {
      return {}
    }
  }

  /** O código digitado vira o da TV na hora (maiúsculas, só o alfabeto do serviço), para caber nas 8 casas. */
  function keepCodeClean(input) {
    input.addEventListener('input', () => {
      const clean = normalizeCode(input.value)
      if (clean !== input.value) input.value = clean
    })
  }

  /** A linha de pulso da marca bate uma vez quando a lista chega (o CSS respeita "reduzir movimento"). */
  function beat() {
    const pulse = $('send-pulse')
    pulse.classList.remove('beat')
    pulse.getBoundingClientRect() // reinicia a animação num segundo envio
    pulse.classList.add('beat')
  }

  // Enviar lista
  async function sendList(e) {
    e.preventDefault()
    const code = normalizeCode($('code').value)
    const dns = window.PairLib.extractUrl($('link').value)
    if (code.length !== CODE_LENGTH) return status('send-status', 'Digite os 8 caracteres do código que aparece na TV.')
    if (!dns) return status('send-status', 'Cole o link da lista ou o endereço do servidor.')
    const button = $('send-button')
    button.disabled = true
    status('send-status', 'Enviando…', true)
    try {
      const keyRes = await fetch(`/v1/inbox/${code}/key`)
      const key = await readJson(keyRes)
      if (!keyRes.ok) return status('send-status', key.error || 'Não foi possível enviar agora. Tente de novo.')
      const box = await window.PairLib.seal(key.pub, code, {
        dns,
        username: $('user').value.trim(),
        password: $('pass').value,
        label: $('name').value.trim(),
      })
      const res = await fetch(`/v1/inbox/${code}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ box }) })
      if (!res.ok) return status('send-status', (await readJson(res)).error || 'Não foi possível enviar agora. Tente de novo.')
      $('pass').value = ''
      status('send-status', 'Enviado! Na TV, confirme "Adicionar esta lista?". Ela aparece na tela de entrada ou em Gerenciar listas.', true)
      beat()
    } catch (err) {
      status('send-status', err && err.message === 'too_long' ? 'A lista é grande demais para enviar por aqui.' : 'Não foi possível enviar agora. Tente de novo.')
    } finally {
      button.disabled = false
    }
  }

  // Assinar: o botão leva o código para a tela de pagamento (/pagar, RFC-020)
  function updateSubLink() {
    const code = normalizeCode($('sub-code').value)
    $('sub-pay').href = code ? `/pagar?tipo=aparelho&codigo=${code}` : '/pagar?tipo=aparelho'
  }

  function checkSubCode(e) {
    if (normalizeCode($('sub-code').value).length === CODE_LENGTH) return
    e.preventDefault()
    status('sub-status', 'Digite os 8 caracteres do código que aparece na TV.')
  }

  // Créditos
  const unitPrice = (qty) => (config.creditTiers.find(([min]) => qty >= min) || [])[1]

  /** Marca na tabela a faixa de preço da quantidade digitada (nenhuma, se a quantidade não vale). */
  function markTier(qty) {
    const tier = qty ? config.creditTiers.find(([min]) => qty >= min) : null
    for (const tr of $('tier-rows').children) {
      const current = !!tier && Number(tr.dataset.min) === tier[0]
      tr.classList.toggle('is-current', current)
      if (current) tr.setAttribute('aria-current', 'true')
      else tr.removeAttribute('aria-current')
    }
  }

  function updateTotal() {
    const qty = Number($('credit-qty').value)
    if (!Number.isInteger(qty) || qty < config.minCredits) {
      $('credit-total').textContent = `Compre no mínimo de ${config.minCredits} créditos.`
      markTier(null)
      return null
    }
    markTier(qty)
    const unit = unitPrice(qty)
    $('credit-total').textContent = `Total: ${brl(unit * qty)} (${qty} × ${brl(unit)})`
    $('credit-pay').href = `/pagar?tipo=creditos&qtd=${qty}`
    return { qty, total: unit * qty }
  }

  function checkCredits(e) {
    if (updateTotal()) return
    e.preventDefault()
    status('credit-status', `Compre no mínimo ${config.minCredits} créditos.`)
  }

  function renderTiers() {
    const rows = config.creditTiers.slice().reverse()
    $('tier-rows').textContent = ''
    rows.forEach(([min, cents], i) => {
      const next = rows[i + 1]
      const tr = document.createElement('tr')
      tr.dataset.min = min
      const range = next ? `${min} a ${next[0] - 1}` : `${min} ou mais`
      for (const text of [range, brl(cents)]) {
        const td = document.createElement('td')
        td.textContent = text
        tr.appendChild(td)
      }
      $('tier-rows').appendChild(tr)
    })
  }

  // Landing (RFC-025 §2): preços do servidor e o download certo para quem abriu o site
  /** 'phone' (celular Android), 'soon' (TVs Samsung/LG) ou 'tv' (Android TV, TV box, computador e o resto). */
  function deviceKind(ua) {
    if (/Tizen|Web0S|webOS|SMART-TV|NetCast/i.test(ua)) return 'soon'
    if (/Android/i.test(ua) && /Mobile/i.test(ua)) return 'phone'
    return 'tv'
  }

  function setupLanding() {
    if (config) {
      $('device-price').textContent = brl(config.devicePriceCents).replace(/,00$/, '')
      renderTiers()
      if (config.playUrl) {
        $('phone-link').href = config.playUrl
        $('phone-link').textContent = 'Abrir na Google Play'
        $('phone-note').textContent = 'Instale pela Google Play.'
      }
    }
    $('apk-address').textContent = `${location.host}/apk`
    const yours = document.querySelector(`.download[data-device="${deviceKind(navigator.userAgent)}"]`)
    if (yours) yours.classList.add('is-yours')
  }

  // Minha TV (RFC-025 §3): estado do aparelho pelo código e cancelamento da renovação com o e-mail do pagamento
  let clientCode = ''
  const longDate = (ms) => new Date(ms).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })

  function showStatus(code, data) {
    const subscribe = config ? `Assinar por ${brl(config.devicePriceCents)} ao ano` : 'Assinar'
    const views = {
      active: ['Ativo', `Ativo até ${longDate(data.until)}`, data.renews ? 'Renova sozinho no cartão.' : 'Renove quando quiser, com Pix ou cartão.', 'Renovar mais 1 ano', 'button secondary'],
      trial: ['Teste grátis', `Teste até ${longDate(data.until)}`, 'Assine para continuar usando depois do teste.', subscribe, 'button'],
      none: ['Sem ativação', 'Não há ativação para este código', 'Confira o código na tela da TV (8 letras e números). Se você já pagou, fale com o suporte.', subscribe, 'button'],
    }
    const [badge, title, detail, action, cls] = views[data.state] || views.none
    $('status-badge').textContent = badge
    $('status-badge').className = `state state-${views[data.state] ? data.state : 'none'}`
    $('status-title').textContent = title
    $('status-detail').textContent = detail
    $('status-renew').textContent = action
    $('status-renew').className = cls
    $('status-renew').href = `/pagar?tipo=aparelho&codigo=${code}`
    const support = whatsapp(`Olá! O código da minha TV é ${code}.`)
    $('status-support').hidden = !support
    if (support) $('status-support').href = support
    $('cancel-open').hidden = !(data.state === 'active' && data.renews)
    $('cancel-form').hidden = true
    $('cancel-msg').textContent = ''
    $('cancel-email').disabled = false
    $('cancel-form').querySelector('button').hidden = false
    $('status-result').hidden = false
  }

  async function lookup(e) {
    e.preventDefault()
    const code = normalizeCode($('status-code').value)
    if (code.length !== CODE_LENGTH) return status('status-msg', 'Digite os 8 caracteres do código que aparece na TV.')
    const button = $('status-form').querySelector('button')
    button.disabled = true
    try {
      const res = await fetch('/v1/device-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
      const data = await readJson(res)
      if (!res.ok) return status('status-msg', data.error || 'Não foi possível consultar agora. Tente de novo.')
      $('status-msg').textContent = ''
      clientCode = code
      showStatus(code, data)
    } catch (_) {
      status('status-msg', 'Sem conexão. Confira a internet e tente de novo.')
    } finally {
      button.disabled = false
    }
  }

  async function cancelRenewal(e) {
    e.preventDefault()
    const email = $('cancel-email').value.trim()
    if (!email.includes('@')) return status('cancel-msg', 'Informe o e-mail usado no pagamento.')
    const button = $('cancel-form').querySelector('button')
    button.disabled = true
    try {
      const res = await fetch('/v1/subscription/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: clientCode, email }) })
      const data = await readJson(res)
      if (!res.ok) return status('cancel-msg', data.error || 'Não foi possível cancelar agora. Tente de novo.')
      status('cancel-msg', 'Renovação cancelada. O aparelho continua ativo até o fim do período pago.', true)
      $('status-detail').textContent = 'Renovação automática cancelada.'
      $('cancel-open').hidden = true
      $('cancel-email').disabled = true
      button.hidden = true
    } catch (_) {
      status('cancel-msg', 'Sem conexão. Confira a internet e tente de novo.')
    } finally {
      button.disabled = false
    }
  }

  function setupClient() {
    keepCodeClean($('status-code'))
    $('status-code').value = normalizeCode(new URLSearchParams(location.search).get('codigo'))
    $('status-form').addEventListener('submit', lookup)
    $('cancel-open').addEventListener('click', () => {
      $('cancel-form').hidden = false
      $('cancel-email').focus()
    })
    $('cancel-form').addEventListener('submit', cancelRenewal)
  }

  async function start() {
    try {
      config = await (await fetch('/v1/site-config')).json()
    } catch (_) {
      config = null
    }
    if (config && config.contactUrl && $('support-link')) {
      $('support-link').href = whatsapp('Olá! Preciso de ajuda com o Pulse Player.')
      $('support-link').hidden = false
    }
    for (const id of ['code', 'sub-code']) if ($(id)) keepCodeClean($(id))
    if ($('landing')) setupLanding()
    if ($('status-form')) setupClient()
    if ($('send-form')) {
      $('send-form').addEventListener('submit', sendList)
      // O app no celular abre o site com o código do aparelho (RFC-023): já preenchido, falta só a lista.
      const fromApp = normalizeCode(new URLSearchParams(location.search).get('codigo'))
      if (fromApp) {
        $('code').value = fromApp
        if ($('link')) $('link').focus()
      }
    }
    if ($('sub-form') && config) {
      $('device-price').textContent = brl(config.devicePriceCents)
      $('sub-code').value = normalizeCode(new URLSearchParams(location.search).get('codigo'))
      updateSubLink()
      $('sub-code').addEventListener('input', updateSubLink)
      $('sub-pay').addEventListener('click', checkSubCode)
      // Enter no campo do código segue para o pagamento, como o botão.
      $('sub-form').addEventListener('submit', (e) => {
        e.preventDefault()
        $('sub-pay').click()
      })
    }
    if ($('credit-form') && config) {
      renderTiers()
      updateTotal()
      $('credit-qty').addEventListener('input', updateTotal)
      $('credit-pay').addEventListener('click', checkCredits)
      $('credit-form').addEventListener('submit', (e) => {
        e.preventDefault()
        $('credit-pay').click()
      })
    }
  }

  setupLegalNotice()
  start()
})()
