/* Site do Pulse Player (RFC-021): enviar lista cifrada para a TV, assinar o aparelho e comprar créditos (pagamento em /pagar). */
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
    if ($('send-form')) $('send-form').addEventListener('submit', sendList)
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

  start()
})()
