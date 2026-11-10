# Plano de robustez — o que falta para o Pulse Player ficar redondo

Escrito em 2026-11-10, logo depois do primeiro Pix real aprovado (aparelho `DZDQ2Q29`, R$ 25,00).
Cada item diz **o problema**, **a causa** e **como corrigir**. A ordem é a de importância.
Marque `[x]` quando fechar. O plano geral do projeto continua em `docs/PLANO.md`.

## Situação hoje

- Pix em produção funcionando de ponta a ponta: pagamento, webhook e liberação do aparelho.
- Credenciais de produção gravadas no Worker `pulse-license` (`scripts/mp-producao.sh`).
- Correções das auditorias de 2026-11-09 e 2026-11-10 publicadas no servidor de licença.
- Lint limpo e 1146 de 1147 testes passando (o que falha, `tests/tvCompat.test.js`, só quebra em worktree sem
  `node_modules/vite/bin`).

---

## 1. Logs dos servidores estão desligados

- [x] (2026-11-10, só no servidor de licença: avisos do código, sem log por requisição; o pareamento fica sem logs
  porque a política de privacidade promete isso) **Problema:** se um webhook falhar, uma entrega travar ou alguém tentar forjar assinatura, não fica registro.
- **Causa:** `"observability": { "enabled": false }` em `server/license/wrangler.jsonc:29` e em
  `server/pair/wrangler.jsonc:25`. O código já escreve os avisos (`console.warn` em
  `license-checkout.mjs`, `license-checkout-orders.mjs`, `license-checkout-subscriptions.mjs`), mas a Cloudflare
  descarta.
- **Como corrigir:** trocar para `true` nos dois arquivos e publicar (`npm run license:deploy` e o deploy do
  pareamento). Os logs aparecem no painel da Cloudflare em Workers → `pulse-license` → Logs.
- **Cuidado:** antes de ligar, conferir que nenhum `console.*` escreve token, chave de aparelho inteira ou contato do
  comprador. Log não pode ter dado sensível.

## 2. Estorno não derrubava a licença (achado no teste real de 2026-11-10)

- [ ] **Problema:** o Pix foi devolvido, o dinheiro voltou, e o aparelho `DZDQ2Q29` continuou ativado.
- **Causa:** o servidor só ficava sabendo do estorno pelo webhook, e ele não chegou (ou foi recusado sem deixar
  rastro). O pagamento tinha plano B (a tela `/pagar` consulta o Mercado Pago a cada minuto); o estorno não tinha,
  e o "Reprocessar" do painel recusava pedido entregue.
- **Correção (commitada, falta publicar da pasta certa):**
  1. Automático: o cron do Worker roda de hora em hora e confere cada pedido entregue a cada 6 h, por 180 dias
     (`recheckRefunds` em `server/license/license-checkout-orders.mjs`). Estorno é percebido em até ~7 h mesmo
     sem webhook.
  2. Manual: botão **Conferir estorno** nos pedidos entregues do painel.
  3. Webhook recusado por assinatura agora deixa `[checkout] webhook recusado` no log.
- **Ainda conferir:** no painel de desenvolvedor do Mercado Pago, aba **Webhooks**, o código HTTP das tentativas.
  401 = assinatura secreta errada (rodar `scripts/mp-producao.sh` de novo com a de produção).
- **Assinatura anual no cartão:** parcela estornada é tratada pelo webhook `subscription_authorized_payment`; ainda
  sem conferência periódica (só quando o cartão for validado).

## 3. Ninguém avisa quando algo quebra

- [ ] **Problema:** se o site cair ou um pedido ficar "pago, sem entrega", você só descobre pelo cliente.
- **Causa:** existe `/healthz` nos dois servidores, mas nada consulta.
- **Como corrigir:**
  1. Monitor externo gratuito (UptimeRobot ou similar) em `https://pulseplayer.com.br/healthz` e no `/healthz` do
     pareamento, avisando por e-mail ou WhatsApp.
  2. No cron diário que já existe (`triggers.crons` em `wrangler.jsonc`), contar pedidos em `paid`/`delivering` há
     mais de 30 minutos e registrar um aviso no log. Depois, se fizer falta, mandar por e-mail.

## 4. Cartão e assinatura anual sem validação

- [ ] **Problema:** o cartão aparece em `/pagar`, mas nunca teve um pagamento aprovado (em teste o Mercado Pago
  recusava com 400 "User bad request").
- **Causa:** limitação do ambiente de teste; decisão de 2026-11-04 foi validar com produção.
- **Decisão (2026-11-10):** fica como está até o dono testar; o app ainda não foi lançado para clientes.
- **Como validar:** pagar um aparelho com cartão real, conferir a liberação, cancelar a renovação pelo painel
  (**Pagamentos** → "Cancelar renovação") e estornar. Se recusar, o corpo do erro sai nos logs (item 1).
- **Saída de emergência:** remover `MP_PUBLIC_KEY` de `wrangler.jsonc` e publicar; `/pagar` passa a oferecer só Pix
  (`license-core.mjs:184`).

## 5. Nota de qualidade do Mercado Pago

- [ ] **Problema:** o painel de desenvolvedor mostra 0 de 100, "Avaliação pendente".
- **Causa:** a medição pede o Order ID de um pagamento. Não é bloqueio: não impede de receber.
- **Como fazer:** `dono.pulseplayer.com.br/admin` → **Pagamentos** → coluna **Pedido no Mercado Pago** → copiar o
  `ORD…` → colar em **Qualidade da integração → Avaliar qualidade**. Ajustar no servidor os campos que ele apontar
  (o corpo do pedido é montado em `orderBody`, `server/license/license-checkout.mjs`).

## 6. O app não registra erros

- [ ] **Problema:** travamento na TV de um cliente não deixa rastro.
- **Causa:** não há captura global de erro em `src/` (nem `app.config.errorHandler` nem `unhandledrejection`).
- **Como corrigir (menor versão que resolve):** guardar os últimos erros no aparelho (mensagem, tela, versão, sem
  URL de lista nem senha: usar `maskSecrets` de `src/services/netEnv`) e mostrar em Conta → "Diagnóstico", com o
  código do aparelho, para o cliente fotografar e mandar no WhatsApp. Envio automático ao servidor só se isso não
  bastar.

## 7. Backup do banco

- [ ] **Problema:** licenças e pedidos vivem só no D1 da Cloudflare; não há roteiro de restauração.
- **Causa:** nunca foi escrito.
- **Como corrigir:** documentar em `docs/` os dois comandos (bash): exportar
  `npx wrangler d1 export pulse-license --remote --output backup.sql --config server/license/wrangler.jsonc` e
  restaurar por data com `wrangler d1 time-travel` (o D1 guarda 30 dias). Rodar a exportação uma vez por mês e
  guardar fora do projeto. O arquivo tem dados de clientes: nunca vai para o Git.

## 8. Publicações pendentes

- [x] (2026-11-10) Worker de pareamento: recebeu correções na auditoria de 2026-11-10 e ainda não foi republicado.
- [ ] Commits desta rodada ainda não estão no GitHub (branch `claude/project-review-updates-1b0035`).
- [ ] As correções do app só chegam aos aparelhos no próximo APK/AAB (gerado pelo CI no merge da `main`).

## 9. Testes em aparelho (com o dono)

- [ ] APK atual no tablet e na Android TV (`docs/PLANO.md:58`).
- [ ] Build de TV (`npm run build:tizen` / `build:webos`) numa pasta com `node_modules` completo.

## 10. Desempenho e escala

- [ ] **Problema:** um testador achou o app "um pouco pesado" na TV (2026-11-04).
- **Causa:** desconhecida. Medir antes de mexer.
- **Como fazer:** gravar um perfil de desempenho na TV mais fraca disponível, abrindo uma lista grande; atacar só o
  que a medição mostrar.

## Limpeza de código (sem pressa)

- [ ] `src/stores/playerStore.js` ainda tem 482 linhas numa closure só. Dividir exige reescrever (não é só mover);
  fazer apenas com os testes do player cobrindo fila, histórico e zapping.
