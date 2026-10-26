/** Página do celular (RFC-016): cola o link, cifra no navegador e entrega ao servidor de pareamento. */
;(function () {
  var lib = window.PairLib

  var TEXTS = {
    'pt-BR': {
      title: 'Enviar lista para a TV',
      codeLabel: 'Código da TV',
      linkLabel: 'Link da lista',
      linkHint: 'Cole o link (pode colar a mensagem inteira do WhatsApp ou do e-mail: o link é achado sozinho).',
      more: 'Servidor com usuário e senha (opcional)',
      userLabel: 'Usuário',
      passLabel: 'Senha',
      nameLabel: 'Apelido da lista',
      send: 'Enviar para a TV',
      sending: 'Enviando…',
      privacy: 'Os dados vão cifrados e só a sua TV consegue abrir. Nada fica guardado depois de alguns minutos.',
      doneTitle: 'Enviado!',
      doneText: 'Olhe a TV e confirme para adicionar a lista.',
      doneHint: 'Se a TV não mostrar nada em 1 minuto, gere um novo código na TV e envie de novo.',
      errBadCode: 'Digite as 6 letras do código que aparece na TV.',
      errNoLink: 'Cole o link da lista (começa com http:// ou https://).',
      errTooLong: 'Esse link é grande demais. Envie só o link da lista.',
      errNotFound: 'Código não encontrado ou expirado. Confira as letras na TV (não usamos 0, O, 1, I nem L) ou gere um novo código.',
      errSent: 'Esse código já recebeu uma lista. Gere um novo código na TV.',
      errBusy: 'Muitas tentativas. Aguarde um minuto.',
      errNetwork: 'Sem conexão com o servidor. Verifique a internet do celular e tente de novo.',
      errGeneric: 'Algo deu errado. Tente de novo.',
      errCrypto: 'Este navegador não consegue cifrar os dados. Abra o endereço https do Pulse Player.',
    },
    en: {
      title: 'Send list to your TV',
      codeLabel: 'TV code',
      linkLabel: 'List link',
      linkHint: 'Paste the link (you can paste the whole WhatsApp or e-mail message: the link is found automatically).',
      more: 'Server with username and password (optional)',
      userLabel: 'Username',
      passLabel: 'Password',
      nameLabel: 'List nickname',
      send: 'Send to TV',
      sending: 'Sending…',
      privacy: 'The data is encrypted and only your TV can open it. Nothing is kept after a few minutes.',
      doneTitle: 'Sent!',
      doneText: 'Look at your TV and confirm to add the list.',
      doneHint: 'If the TV shows nothing in 1 minute, create a new code on the TV and send again.',
      errBadCode: 'Type the 6 letters of the code shown on the TV.',
      errNoLink: 'Paste the list link (it starts with http:// or https://).',
      errTooLong: 'That link is too long. Send only the list link.',
      errNotFound: 'Code not found or expired. Check the letters on the TV (we never use 0, O, 1, I or L) or create a new code.',
      errSent: 'This code already received a list. Create a new code on the TV.',
      errBusy: 'Too many attempts. Wait a minute.',
      errNetwork: 'Cannot reach the server. Check the phone connection and try again.',
      errGeneric: 'Something went wrong. Try again.',
      errCrypto: 'This browser cannot encrypt the data. Open the Pulse Player https address.',
    },
  }

  var lang = /^pt/i.test(navigator.language || '') ? 'pt-BR' : 'en'
  var t = TEXTS[lang]
  var $ = function (id) { return document.getElementById(id) }

  document.documentElement.lang = lang === 'en' ? 'en' : 'pt-BR'
  Array.prototype.forEach.call(document.querySelectorAll('[data-t]'), function (el) {
    el.textContent = t[el.getAttribute('data-t')]
  })

  var form = $('form')
  var msg = $('msg')
  var send = $('send')
  var canEncrypt = !!(window.crypto && window.crypto.subtle)

  function fail(key) {
    msg.textContent = t[key]
  }

  function statusKey(status) {
    if (status === 404) return 'errNotFound'
    if (status === 409) return 'errSent'
    if (status === 429) return 'errBusy'
    return 'errGeneric'
  }

  function setBusy(busy) {
    send.disabled = busy
    send.textContent = busy ? t.sending : t.send
  }

  async function submit() {
    msg.textContent = ''
    var code = lib.normalizeCode($('code').value)
    if (code.length !== lib.CODE_LENGTH) return fail('errBadCode')
    var link = lib.extractUrl($('link').value)
    if (!link) return fail('errNoLink')

    setBusy(true)
    try {
      var keyRes = await fetch('/v1/sessions/' + code)
      if (!keyRes.ok) return fail(statusKey(keyRes.status))
      var key = (await keyRes.json()).pub

      var box = await lib.seal(key, code, {
        dns: link,
        username: $('user').value.trim(),
        password: $('pass').value,
        label: $('name').value.trim(),
      })
      var sent = await fetch('/v1/sessions/' + code + '/payload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ box: box }),
      })
      if (!sent.ok) return fail(statusKey(sent.status))

      form.hidden = true
      $('done').hidden = false
    } catch (err) {
      fail(err && err.message === 'too_long' ? 'errTooLong' : err instanceof TypeError ? 'errNetwork' : 'errGeneric')
    } finally {
      setBusy(false)
    }
  }

  $('code').value = lib.normalizeCode(location.pathname.replace(/^\//, ''))
  if (!canEncrypt) {
    fail('errCrypto')
    send.disabled = true
  }
  form.addEventListener('submit', function (event) {
    event.preventDefault()
    if (canEncrypt) submit()
  })
})()
