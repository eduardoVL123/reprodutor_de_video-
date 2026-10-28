/* Tela de pagamento do Pulse Player (RFC-020): Pix e cartão pelo Mercado Pago. O preço e a entrega são do servidor. */
;(function () {
  const $ = (id) => document.getElementById(id)
  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // igual ao serviço de licença (sem 0/O/1/I/L)
  const CODE_LENGTH = 8
  const RESELLER_KEY = 'pulse-reseller-key' // mesma chave da aba usada pelo painel da revenda (RFC-022)
  const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/
  const POLL_MS = 3000
  const SUBSCRIPTION_POLL_MS = 15000
  const TYPES = {
    aparelho: { kind: 'device_annual', title: 'Assinar meu aparelho' },
    creditos: { kind: 'credits', title: 'Comprar créditos' },
    revenda: { kind: 'credits', title: 'Comprar créditos para a revenda' },
  }
  const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const params = new URLSearchParams(location.search)
  const type = Object.prototype.hasOwnProperty.call(TYPES, params.get('tipo')) ? params.get('tipo') : null
  const quantity = Number(params.get('qtd'))
  const nextFrame = (fn) => (window.requestAnimationFrame ? window.requestAnimationFrame(fn) : fn())
  let config = null
  let totalCents = null
  let method = 'pix'
  let cardForm = null
  let cardRequested = false
  let order = null
  let pollTimer = null
  let busy = false

  function normalizeCode(text) {
    let out = ''
    for (const ch of String(text || '').toUpperCase()) {
      if (CODE_ALPHABET.includes(ch) && out.length < CODE_LENGTH) out += ch
    }
    return out
  }

  function say(text, ok) {
    $('result').textContent = text
    $('result').className = ok ? 'ok' : 'error'
  }

  function whatsapp(message) {
    if (!config || !config.contactUrl) return ''
    return `${config.contactUrl}${config.contactUrl.includes('?') ? '&' : '?'}text=${encodeURIComponent(message)}`
  }

  /** Erro que impede o pagamento: aviso visível (com um link quando há saída) em vez de campos em branco. */
  function initError(text, link, linkText) {
    const box = $('checkout-init-error')
    box.textContent = text
    if (link) {
      const a = document.createElement('a')
      a.href = link
      a.textContent = linkText
      box.append(' ', a)
    }
    box.hidden = false
  }

  function stopPage(text, link, linkText) {
    initError(text, link, linkText)
    $('form-checkout').hidden = true
  }

  function resellerKey() {
    try {
      return sessionStorage.getItem(RESELLER_KEY) || ''
    } catch (_) {
      return ''
    }
  }

  async function readJson(res) {
    try {
      return await res.json()
    } catch (_) {
      return {}
    }
  }

  function computeTotal() {
    if (type === 'aparelho') return config.devicePriceCents
    if (!Number.isInteger(quantity) || quantity < config.minCredits) return null
    return config.creditTiers.find(([min]) => quantity >= min)[1] * quantity
  }

  /** O que vai para o servidor; recusa aqui o que o servidor recusaria (mesmas mensagens). */
  function purchase(payMethod, card) {
    const email = $('form-checkout__cardholderEmail').value.trim()
    if (!EMAIL.test(email)) throw new Error('Informe um e-mail válido.')
    const body = { kind: TYPES[type].kind, method: payMethod }
    if (type === 'aparelho') {
      const code = normalizeCode($('pay-code').value)
      if (code.length !== CODE_LENGTH) throw new Error('Digite os 8 caracteres do código que aparece na TV.')
      body.code = code
    } else {
      body.quantity = quantity
    }
    if (type === 'creditos') {
      body.name = $('pay-name').value.trim()
      body.contact = $('pay-contact').value.trim()
      if (!body.name || !body.contact) throw new Error('Informe seu nome e um contato (WhatsApp ou telefone).')
    }
    body.email = email
    if (card) body.card = card
    return body
  }

  async function send(body) {
    const revenda = type === 'revenda'
    const headers = { 'Content-Type': 'application/json' }
    if (revenda) headers.Authorization = `Bearer ${resellerKey()}`
    const res = await fetch(revenda ? '/api/v1/credits/checkout' : '/v1/checkout', { method: 'POST', headers, body: JSON.stringify(body) })
    const data = await readJson(res)
    if (!res.ok) throw new Error(data.error || 'Não foi possível iniciar o pagamento. Tente de novo.')
    return data
  }

  // Acompanhamento do pedido
  function poll(delay) {
    clearTimeout(pollTimer)
    pollTimer = setTimeout(checkStatus, delay)
  }

  async function checkStatus() {
    let data
    try {
      const res = await fetch(`/v1/checkout/${order.orderId}?s=${encodeURIComponent(order.viewSecret)}`)
      data = await readJson(res)
      if (!res.ok) throw new Error(data.error)
    } catch (_) {
      return poll(POLL_MS)
    }
    if (data.status === 'delivered') return done(data.result || {})
    if (data.status === 'failed') {
      $('challenge').hidden = true
      return say('Pagamento recusado ou cancelado. Tente de novo ou use outra forma de pagamento.')
    }
    if (data.status === 'expired') {
      $('pix-result').hidden = true
      return say('O prazo deste pagamento acabou. Gere um novo.')
    }
    poll(order.subscription ? SUBSCRIPTION_POLL_MS : POLL_MS)
  }

  function done(result) {
    clearTimeout(pollTimer)
    for (const id of ['form-checkout', 'pix-result', 'challenge']) $(id).hidden = true
    say('', true)
    if (result.activationEndsAt) {
      const until = new Date(result.activationEndsAt).toLocaleDateString('pt-BR')
      $('done-text').textContent = `Seu aparelho está ativado até ${until}. Na TV, toque em "Já paguei, verificar".`
    } else {
      const where = type === 'revenda' ? 'somados ao seu saldo' : 'na sua conta de revenda'
      $('done-text').textContent = `${result.credits} créditos ${where}.`
    }
    if (result.resellerKey) {
      $('done-key').textContent = `Chave do seu painel (copie agora, ela aparece só esta vez): ${result.resellerKey}`
      $('done-key').hidden = false
    }
    $('done-panel').hidden = type === 'aparelho'
    $('pay-done').hidden = false
  }

  // Pix
  async function generatePix() {
    if (busy) return
    busy = true
    $('pix-generate').disabled = true
    say('Gerando o Pix…', true)
    try {
      order = await send(purchase('pix'))
      $('pix-qr').setAttribute('src', `data:image/png;base64,${order.pix.qrCodeBase64}`)
      $('pix-code').value = order.pix.qrCode
      $('pix-result').hidden = false
      say('Aguardando o pagamento. Assim que o Pix for pago, esta tela confirma sozinha.', true)
      poll(POLL_MS)
    } catch (err) {
      say(err.message)
    } finally {
      busy = false
      $('pix-generate').disabled = false
    }
  }

  function copyPix() {
    const code = $('pix-code').value
    const copied = navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject(new Error('sem clipboard'))
    copied.then(() => say('Código copiado. Cole no app do seu banco, na opção Pix copia e cola.', true)).catch(() => $('pix-code').select())
  }

  // Cartão (SDK JS do Mercado Pago: número, validade e CVV ficam em iframes do Mercado Pago)
  const SECURE_HOSTS = [
    ['form-checkout__cardNumber', 'card-number-label'],
    ['form-checkout__expirationDate', 'expiration-label'],
    ['form-checkout__securityCode', 'security-code-label'],
  ]

  function assertSecureFieldsMounted() {
    const failures = SECURE_HOSTS.filter(([id, labelId]) => {
      const host = $(id)
      const rect = host.getBoundingClientRect()
      return host.querySelectorAll('iframe').length !== 1 || !rect.width || !rect.height || !$(labelId) || getComputedStyle(host).pointerEvents === 'none'
    })
    if (failures.length) {
      console.error('[pagar] campos seguros não montaram:', failures.map(([id]) => id).join(', '))
      initError('Os campos do cartão não carregaram. Atualize a página ou pague com Pix.')
    }
  }

  /** Chave pública lida na hora, sem cache (nunca embutida no HTML); sem ela o cartão fica indisponível. */
  async function loadPublicKey() {
    try {
      const res = await fetch('/v1/mp-config', { cache: 'no-store' })
      const data = await readJson(res)
      return res.ok && data.publicKey ? data.publicKey : ''
    } catch (_) {
      return ''
    }
  }

  async function mountCard() {
    if (typeof window.MercadoPago !== 'function') {
      return initError('Não foi possível carregar o pagamento com cartão (um bloqueador de anúncios pode impedir). Use o Pix ou outro navegador.')
    }
    const publicKey = await loadPublicKey()
    if (!publicKey) return initError('Pagamento com cartão indisponível no momento. Use o Pix.')
    const mp = new window.MercadoPago(publicKey, { locale: 'pt-BR' })
    cardForm = mp.cardForm({
      amount: (totalCents / 100).toFixed(2),
      iframe: true,
      form: {
        id: 'form-checkout',
        cardNumber: { id: 'form-checkout__cardNumber', placeholder: '0000 0000 0000 0000' },
        expirationDate: { id: 'form-checkout__expirationDate', placeholder: 'MM/AA' },
        securityCode: { id: 'form-checkout__securityCode', placeholder: 'CVV' },
        cardholderName: { id: 'form-checkout__cardholderName' },
        issuer: { id: 'form-checkout__issuer' },
        installments: { id: 'form-checkout__installments' },
        identificationType: { id: 'form-checkout__identificationType' },
        identificationNumber: { id: 'form-checkout__identificationNumber' },
        cardholderEmail: { id: 'form-checkout__cardholderEmail' },
      },
      callbacks: {
        onFormMounted: (error) => {
          if (error) return initError('Os campos do cartão não carregaram. Atualize a página ou pague com Pix.')
          nextFrame(assertSecureFieldsMounted)
        },
        onSubmit: (event) => {
          event.preventDefault()
          if (method === 'card') payWithCard()
        },
      },
    })
  }

  async function payWithCard() {
    if (busy) return
    busy = true
    $('form-checkout__submit').disabled = true
    say('Processando o pagamento…', true)
    try {
      const data = cardForm.getCardFormData()
      if (!data.token) throw new Error('Confira os dados do cartão.')
      order = await send(purchase('card', { token: data.token, paymentMethodId: data.paymentMethodId, cpf: data.identificationNumber }))
      if (order.status === 'delivered') return checkStatus()
      if (order.subscription) {
        say('Assinatura criada! O Mercado Pago cobra a primeira anuidade em até 1 hora e a TV é liberada assim que o pagamento for aprovado. Pode fechar esta página.', true)
        return poll(SUBSCRIPTION_POLL_MS)
      }
      if (order.challengeUrl) {
        $('challenge').setAttribute('src', order.challengeUrl)
        $('challenge').hidden = false
        return say('Confirme a compra na tela do seu banco, logo abaixo.', true)
      }
      say('Pagamento em análise. Esta tela confirma sozinha.', true)
      poll(POLL_MS)
    } catch (err) {
      say(err.message)
    } finally {
      busy = false
      $('form-checkout__submit').disabled = false
    }
  }

  function selectMethod(next) {
    method = next
    $('method-pix').setAttribute('aria-pressed', String(next === 'pix'))
    $('method-card').setAttribute('aria-pressed', String(next === 'card'))
    $('pix-section').hidden = next !== 'pix'
    $('card-section').hidden = next !== 'card'
    // Os iframes só montam com a área visível (tamanho real), uma vez por página.
    if (next === 'card' && !cardRequested) {
      cardRequested = true
      nextFrame(mountCard)
    }
  }

  async function start() {
    try {
      config = await (await fetch('/v1/site-config', { cache: 'no-store' })).json()
    } catch (_) {
      config = null
    }
    if (config && config.contactUrl) {
      $('support-link').href = whatsapp('Olá! Preciso de ajuda com o pagamento do Pulse Player.')
      $('support-link').hidden = false
    }
    totalCents = type && config ? computeTotal() : null
    if (totalCents === null) {
      $('pay-total').textContent = '—'
      const min = config ? config.minCredits : 10
      return stopPage(type && config ? `Quantidade inválida: a compra mínima é de ${min} créditos.` : 'Não foi possível abrir o pagamento. Volte e tente de novo.')
    }
    $('pay-title').textContent = TYPES[type].title
    $('pay-what').textContent = type === 'aparelho' ? '1 aparelho por 1 ano' : `${quantity} créditos (1 crédito = 1 aparelho por 1 ano)`
    $('pay-total').textContent = brl(totalCents)

    if (!config.payments) {
      return stopPage('O pagamento pelo site está indisponível no momento.', whatsapp(`Quero pagar: ${TYPES[type].title} (${brl(totalCents)}).`), 'Falar pelo WhatsApp')
    }
    if (type === 'revenda' && !resellerKey()) return stopPage('Entre no painel da revenda para comprar créditos.', '/revenda/', 'Abrir o painel')

    $('fields-device').hidden = type !== 'aparelho'
    $('fields-buyer').hidden = type !== 'creditos'
    $('pay-code').value = normalizeCode(params.get('codigo'))
    // Igual ao resto do site: o código vira o da TV enquanto a pessoa digita (cabe nas 8 casas).
    $('pay-code').addEventListener('input', () => {
      const clean = normalizeCode($('pay-code').value)
      if (clean !== $('pay-code').value) $('pay-code').value = clean
    })
    $('card-note').textContent =
      type === 'aparelho'
        ? 'No cartão, a assinatura renova sozinha todo ano (R$ 25). Para cancelar a renovação, fale com a gente pelo WhatsApp.'
        : 'Pagamento à vista, em 1 parcela.'

    $('method-pix').addEventListener('click', () => selectMethod('pix'))
    $('method-card').addEventListener('click', () => selectMethod('card'))
    $('pix-generate').addEventListener('click', generatePix)
    $('pix-copy').addEventListener('click', copyPix)
    // O cardForm trata o envio do cartão; com o Pix escolhido, Enter no formulário gera o Pix.
    $('form-checkout').addEventListener('submit', (e) => {
      e.preventDefault()
      if (method === 'pix') generatePix()
    })
    // O desafio 3DS avisa a página quando termina; só então consultamos o pedido (o resultado vem do servidor).
    window.addEventListener('message', (e) => {
      if (order && e.data && e.data.status === 'COMPLETE') {
        $('challenge').hidden = true
        say('Verificando o pagamento…', true)
        checkStatus()
      }
    })
  }

  start()
})()
