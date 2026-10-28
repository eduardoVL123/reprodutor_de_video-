/**
 * Página de planos aberta pelo QR da tela "Ative este aparelho" (RFC-018 R7, D1/D2).
 * D1 (v1): pagamento manual. A página mostra o plano, o código e o contato; vocês liberam no painel.
 */

export const PLANS = [{ name: 'Anual', price: 'R$ 10', detail: 'por aparelho, qualquer lista, por 1 ano' }]

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** Só links http(s) viram botão; qualquer outra coisa é ignorada. */
const safeLink = (url) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(url || '')) ? url : '')

export function plansPage(code, contactUrl) {
  const link = safeLink(contactUrl)
  const plans = PLANS.map(
    (p) => `<li class="plan"><strong>${escapeHtml(p.name)}</strong><span class="price">${escapeHtml(p.price)}</span><small>${escapeHtml(p.detail)}</small></li>`,
  ).join('')
  const contact = link
    ? `<a class="button" href="${escapeHtml(link)}" rel="noopener noreferrer">Falar com a gente para pagar</a>`
    : '<p class="muted">Fale com quem indicou o Pulse Player para pagar.</p>'
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ativar aparelho · Pulse Player</title>
<link rel="stylesheet" href="/a/plans.css">
</head>
<body>
<main>
<h1>Ative seu aparelho</h1>
<p>Código do aparelho</p>
<p class="code">${escapeHtml(code)}</p>
<ul class="plans">${plans}</ul>
<ol class="steps">
<li>Pague o plano pelo contato abaixo.</li>
<li>Informe o código <strong>${escapeHtml(code)}</strong>.</li>
<li>Quando liberarmos, toque em "Já paguei, verificar" no aparelho.</li>
</ol>
${contact}
</main>
</body>
</html>
`
}

export const NOT_FOUND_PAGE = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Código não encontrado · Pulse Player</title><link rel="stylesheet" href="/a/plans.css"></head>
<body><main><h1>Código não encontrado</h1><p>Confira o código que aparece na tela do aparelho.</p></main></body></html>
`

export const PLANS_CSS = `*{box-sizing:border-box}
body{margin:0;background:#0b0f0c;color:#f1f5f9;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
main{max-width:28rem;margin:0 auto;padding:2.5rem 1rem;text-align:center}
h1{font-size:1.6rem;margin:0 0 1.5rem}
.code{font-family:ui-monospace,Consolas,monospace;font-size:2rem;letter-spacing:.2em;color:#b8f000;margin:.25rem 0 1.5rem}
.plans{list-style:none;padding:0;margin:0 0 1.5rem}
.plan{display:flex;flex-direction:column;border:1px solid #2a332c;border-radius:1rem;padding:1rem}
.price{font-size:1.8rem;font-weight:800;color:#b8f000;margin:.25rem 0}
small,.muted{color:#94a3b8}
.steps{text-align:left;line-height:1.6;margin:0 0 1.5rem}
.button{display:block;background:#b8f000;color:#0b0f0c;font-weight:700;text-decoration:none;padding:.9rem 1rem;border-radius:.75rem}
`
