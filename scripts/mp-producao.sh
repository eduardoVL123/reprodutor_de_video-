#!/usr/bin/env bash
# Passa as credenciais de PRODUÇÃO do Mercado Pago de server/license/.env para o Worker de licença e publica.
# Uso (Git Bash, na raiz do projeto): bash scripts/mp-producao.sh
# Os valores não aparecem na tela. Apague o .env depois: `wrangler dev` também o leria.
set -euo pipefail
ENV=server/license/.env
CFG=server/license/wrangler.jsonc
val() { grep -E "^$1=" "$ENV" | head -1 | cut -d= -f2- | tr -d '\r"'"'"' '; }

[ -f "$ENV" ] || { echo "Falta $ENV"; exit 1; }
for k in MP_ACCESS_TOKEN MP_WEBHOOK_SECRET MP_PUBLIC_KEY; do
  [ -n "$(val $k)" ] || { echo "Falta $k em $ENV"; exit 1; }
done
case "$(val MP_ACCESS_TOKEN)" in APP_USR-*) ;; *) echo "MP_ACCESS_TOKEN não é de produção (deve começar com APP_USR-)"; exit 1 ;; esac
case "$(val MP_PUBLIC_KEY)" in APP_USR-*) ;; *) echo "MP_PUBLIC_KEY não é de produção (deve começar com APP_USR-)"; exit 1 ;; esac

# A chave pública não é segredo: fica no wrangler.jsonc (o deploy sobrescreve o que estiver só no painel).
sed -i -E "s|(\"MP_PUBLIC_KEY\": \")[^\"]*|\1$(val MP_PUBLIC_KEY)|" "$CFG"
printf 'MP_ACCESS_TOKEN=%s\nMP_WEBHOOK_SECRET=%s\n' "$(val MP_ACCESS_TOKEN)" "$(val MP_WEBHOOK_SECRET)" \
  | npx wrangler secret bulk --config "$CFG"
npx wrangler deploy --config "$CFG"
echo "Pronto. Apague $ENV e faça o commit do $CFG."
