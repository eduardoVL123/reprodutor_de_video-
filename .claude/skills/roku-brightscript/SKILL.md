---
name: roku-brightscript
description: Regras do app Roku do Pulse Player (pasta roku/, BrighterScript + SceneGraph). Use ao criar, portar ou testar qualquer código em roku/, ao portar um módulo de src/ para a Roku, ou ao mexer nos scripts roku:* e no bsconfig.
---

# App Roku do Pulse Player

Plano completo em `docs/roku/00-roadmap.md` (fases) e `docs/roku/domains/` (um arquivo por domínio). Leia o arquivo do
domínio antes de começar e siga os passos dele.

## Método de port (obrigatório)

1. Leia o módulo de `src/` e o teste Vitest dele em `tests/`.
2. Escreva o `*.spec.bs` com **os mesmos casos** (mesmos valores e textos esperados) ao lado do arquivo novo.
3. Rode `npm run roku:test` e veja falhar; só então escreva o `.bs`.
4. No topo do `.bs`, uma linha dizendo de onde veio: `' Port de src/utils/x.js (casos em tests/x.test.js)`.
5. Mensagens para o usuário são as mesmas do app web (português, mesmo texto).
6. Confira o valor esperado rodando o JS original (`node -e`) quando o teste Vitest não cobrir o caso.

Rooibos: todo `@it` precisa de um `@describe` antes; não existe `assertNotContains` para texto
(use `m.assertTrue(texto.instr("x") < 0)`); helpers de tipo ficam em `roku/source/utils/types.bs`.

## Arquitetura (não quebrar)

- Rede (`roUrlTransfer`), `ParseJson` grande e leitura de arquivo **só em Task node**. Render thread bloqueada fecha o app
  (10 s em produção, 3 s em sideload).
- HTTPS: sempre `SetCertificatesFile("common:/certs/ca-bundle.crt")`.
- Estado compartilhado em `m.global` (substitui Pinia). Sem ciclos: a `MainScene` inicializa na ordem sessão → catálogo
  → player.
- `roRegistrySection` tem 32 KB por app: só estado pequeno (sessão, licença, perfis, PIN). O resto em arquivo.
- Identidade: `roDeviceInfo.GetChannelClientId()`. Nunca `GetDeviceUniqueId()` (obsoleto).
- Cripto: não existe ECDSA nem ECDH; AES-GCM só 128 bits (OS 15.2+). Licença na Roku usa RSA (`roRSA`).
- Tipos: cheque por interface (`GetInterface(v, "ifInt")`, `"ifString"`…), **nunca** pelo nome de `type()`; um inteiro
  dentro de array/objeto vem como `roInteger`.

## Código

- BrighterScript (`.bs`) com `namespace`; funções puras em `roku/source/<area>/`, componentes em `roku/components/`
  (`.xml` + `.bs` com o mesmo nome; `autoImportComponentScript` liga os dois).
- Lógica de decisão em funções puras testáveis (ex.: `nav.onBack`) e o componente só aplica o resultado — suítes
  `@SGNode` podem travar no simulador.
- Foco nativo (`setFocus`, `onKeyEvent`); RowList/MarkupGrid/ZoomRowList para fileiras e grades.
- Teclados: `DynamicKeyboard`, `DynamicPinpad`, `StandardKeyboardDialog` (certificação 4.12). Nunca `KeyboardDialog`.
- Coordenadas FHD 1920×1080; margem segura do projeto (equivalente a `px-24`/`py-14`: 96 px laterais, 56 px vertical).

## Marca e loja

- Fundo grafite `0x0B0F0CFF`, destaque limão `0xB8F000FF`; texto sobre limão é grafite, nunca branco.
- Ícones e splashes vêm de `npm run icons` (`scripts/make-tv-icons.mjs`); não edite os PNG à mão.
- **Cobrança só Roku Pay**: na Roku não pode haver QR/link para o site de planos, código de ativação de licença, preço
  do site nem revendedor. Envio de lista pelo celular é permitido só como entrada de lista (D9).
- Certificação: home pronta em 15 s, tecla em 250 ms, vídeo em 8 s, pacote ≤ 4 MB, Voltar volta um nível e na home
  pergunta antes de sair (um diálogo só).

## Comandos

| Comando | O que faz |
|---|---|
| `npm run roku:test` | compila com Rooibos e roda no simulador brs-engine (sem aparelho) |
| `npm run roku:lint` | bslint |
| `npm run roku:build` | pacote `build/roku/pulse-roku.zip` + checagem de 4 MB |
| `npm run roku:deploy` / `roku:test:device` | envia ao aparelho (`ROKU_HOST`, `ROKU_PASSWORD` no ambiente) |

Antes de dizer que terminou: `roku:test`, `roku:lint`, `roku:build`, `npm test` e `npm run lint` verdes.
O simulador não vale para vídeo, cripto (`roRSA` é simulado) e desempenho — isso só no aparelho.
