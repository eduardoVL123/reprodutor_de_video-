# RFC-027 — Pulse Player na Roku

**Status**: proposta (plano pronto, execução não iniciada) · **Data**: 2026-11-18

## Resumo

App Roku nativo (BrighterScript → BrightScript + SceneGraph) com o mesmo escopo da versão TV, publicado na loja pública
Roku e cobrado **só por Roku Pay** na Roku. As outras plataformas continuam com site, Pix e revendedores.

## Documentos

- Roadmap e decisões: [`docs/roku/00-roadmap.md`](../roku/00-roadmap.md)
- Pesquisa: [`docs/roku/research/`](../roku/research/) — dependências, domínios, stack Roku, riscos
- Planos por domínio: [`docs/roku/domains/`](../roku/domains/) — D0 a D9 e servidor (DS)

## Decisões

1. Reescrita nativa em paralelo; o app Vue segue nas outras plataformas. Testes Vitest viram especificação.
2. Roku Pay exclusivo na Roku (Distribution Agreement §10.3, certificação 2.2, RP 4). Sem código/QR de ativação, sem
   site e sem revendedor dentro do app Roku.
3. Licença assinada também em RSA para a Roku (sem ECDSA nativo); pareamento sem ECDH na variante Roku.
4. `server/` ganha a plataforma `roku`, validação Roku Pay e assinatura RSA, sem mudar o comportamento das outras.

## Antes de começar

Responder Q1-Q3 do roadmap (Roku Pay no Brasil; aceitação de player sem conteúdo e isenções; pareamento pelo celular)
e rodar os spikes da Fase 0 num aparelho Roku real.
