/* Site do Pulse Player (RFC-021): enviar lista cifrada para a TV, assinar o aparelho e comprar créditos. */
;(function () {
  const $ = (id) => document.getElementById(id)
  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // igual ao serviço de licença (sem 0/O/1/I/L)
  const CODE_LENGTH = 8
  const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  let config = null

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
    } catch (err) {
      status('send-status', err && err.message === 'too_long' ? 'A lista é grande demais para enviar por aqui.' : 'Não foi possível enviar agora. Tente de novo.')
    } finally {
      button.disabled = false
    }
  }

  // Assinar
  function subscribe(e) {
    e.preventDefault()
    const code = normalizeCode($('sub-code').value)
    if (code.length !== CODE_LENGTH) return status('sub-status', 'Digite os 8 caracteres do código que aparece na TV.')
    const link = whatsapp(`Quero assinar o Pulse Player no aparelho ${code} (anual, ${brl(config.devicePriceCents)}).`)
    if (!link) return status('sub-status', 'Atendimento indisponível no momento.')
    $('sub-whatsapp').href = link
    $('sub-whatsapp').hidden = false
    status('sub-status', 'Toque em "Abrir o WhatsApp" para falar com a gente.', true)
  }

  // Créditos
  const unitPrice = (qty) => (config.creditTiers.find(([min]) => qty >= min) || [])[1]

  function updateTotal() {
    const qty = Number($('credit-qty').value)
    if (!Number.isInteger(qty) || qty < config.minCredits) {
      $('credit-total').textContent = `Compre no mínimo de ${config.minCredits} créditos.`
      return null
    }
    const unit = unitPrice(qty)
    $('credit-total').textContent = `Total: ${brl(unit * qty)} (${qty} × ${brl(unit)})`
    return { qty, total: unit * qty }
  }

  function buyCredits(e) {
    e.preventDefault()
    const order = updateTotal()
    if (!order) return
    const name = $('credit-name').value.trim()
    if (!name) return status('credit-status', 'Digite o seu nome.')
    const link = whatsapp(`Quero comprar ${order.qty} créditos do Pulse Player (total ${brl(order.total)}). Nome: ${name}.`)
    if (!link) return status('credit-status', 'Atendimento indisponível no momento.')
    $('credit-whatsapp').href = link
    $('credit-whatsapp').hidden = false
    status('credit-status', 'Toque em "Abrir o WhatsApp" para falar com a gente.', true)
  }

  function renderTiers() {
    const rows = config.creditTiers.slice().reverse()
    $('tier-rows').textContent = ''
    rows.forEach(([min, cents], i) => {
      const next = rows[i + 1]
      const tr = document.createElement('tr')
      const range = next ? `${min} a ${next[0] - 1}` : `${min} ou mais`
      for (const text of [range, brl(cents)]) {
        const td = document.createElement('td')
        td.textContent = text
        tr.appendChild(td)
      }
      $('tier-rows').appendChild(tr)
    })
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
    if ($('send-form')) $('send-form').addEventListener('submit', sendList)
    if ($('sub-form') && config) {
      $('device-price').textContent = brl(config.devicePriceCents)
      $('sub-code').value = normalizeCode(new URLSearchParams(location.search).get('codigo'))
      $('sub-form').addEventListener('submit', subscribe)
    }
    if ($('credit-form') && config) {
      renderTiers()
      updateTotal()
      $('credit-qty').addEventListener('input', updateTotal)
      $('credit-form').addEventListener('submit', buyCredits)
    }
  }

  start()
})()
