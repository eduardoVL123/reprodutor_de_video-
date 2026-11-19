# D0 — Fundação Roku (projeto, build, foco, Voltar/Sair)

**Status (2026-11-19)**: passos 2, 3 e 4 feitos — projeto `roku/` com CI e testes Rooibos no simulador, skill
`.claude/skills/roku-brightscript/`, `MainScene` com pilha de telas e "Sair do Pulse Player?" (`roku/source/nav/nav.bs`),
conferida no simulador via ECP. Passo 1 (conta Roku e spikes em aparelho) pendente.

## Estado atual
- Boot: `src/main.js:1-18`; rotas `src/router/index.js:9-28`; overlays globais `src/App.vue:2-5`.
- Navegação: `src/utils/spatialNavigation.js` (1017 LOC) — prioridade de teclas L5-10, pilha de Voltar
  `registerBackHandler` L276, saída em rota raiz L856-868, mapas de teclas L38-86.
- Saída: `src/components/ExitConfirm.vue:29-30,52`; `src/services/platform.js:20-73`; Voltar em aba não-home
  `src/utils/tabBack.js:10-14`.
- Testes-spec: `tests/spatialNavigation.test.js` (23), `tests/exitConfirm.test.js` (5), `tests/router.test.js` (7).

## Estado alvo
- `roku/` com `manifest` (`ui_resolutions=fhd`, `rsg_version=1.3`, firmware mínimo 15.1 — `research/stack-research.md`),
  `MainScene` que troca telas numa pilha própria (substitui o router), `m.global` com o estado compartilhado.
- Foco nativo SceneGraph; **não portar** o motor geométrico. Preservar: pilha de Voltar, memória de foco por tela,
  confirmação de saída com foco em Cancelar, Voltar em aba não-home vai para home (cert. 4.6).
- Constantes de build (URLs de licença/pareamento, chave pública, flag de loja) geradas a partir do `.env`.

## Passos

### 1. Conta Roku e spikes (Fase 0)
**O que muda**: nada no repo além de `docs/roku/spikes/`. Testar no aparelho: `roRSA.Verify` sha256, `roEVPCipher`
aes-128-gcm com tag, TS cru por HTTP, `ParseJson` de 50k itens (lista gerada pelo `npm run mock`).
**Teste**: script BrightScript mínimo por spike, resultado (tempo, memória, sucesso) anotado.
**Rollback**: n/a. **Sucesso**: os 4 resultados registrados em `docs/roku/spikes/RESULTADOS.md`.

### 2. Projeto e CI
**O que muda**: `roku/`, `bsconfig.json`, scripts `roku:*` no `package.json`, job no GitHub Actions (lint bslint, build
BrighterScript, pacote, tamanho ≤ 4 MB).
**Teste**: `npm run roku:lint` e `npm run roku:build` verdes; Rooibos com 1 teste trivial no aparelho via roku-deploy.
**Rollback**: remover a pasta e o job; nada do app web é tocado. **Sucesso**: CI verde em PR.

### 3. Skill `roku-brightscript`
**O que muda**: `.claude/skills/roku-brightscript/SKILL.md` com regras: rede/JSON só em Task, nunca bloquear a render
thread, `SetCertificatesFile`, foco e Voltar, limites de certificação, convenções de nomes.
**Sucesso**: usada em todos os domínios seguintes.

### 4. Casca de navegação
**O que muda**: `MainScene` + pilha de telas + `ExitDialog` (StandardDialog) + tratamento de Voltar.
**Teste**: Rooibos para a pilha; e2e RTA: Voltar em tela interna volta, na home abre o diálogo, Cancelar mantém.
**Rollback**: reverter o commit. **Sucesso**: casos equivalentes de `tests/exitConfirm.test.js` passando.

## Riscos
| Risco | Impacto | Mitigação | Evidência |
|---|---|---|---|
| Render thread bloqueada mata o app | Alto | toda rede/IO em Task; bslint | `research/stack-research.md` |
| Curva de BrightScript (R8) | Médio | BrighterScript + skill do projeto | `research/risk-assessment.md` |

## Dependências
Bloqueia todos os outros domínios.
