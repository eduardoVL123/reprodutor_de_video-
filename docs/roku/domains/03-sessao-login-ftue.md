# D3 — Sessão, listas, login e FTUE

## Estado atual
- `src/stores/authStore.js` (539): login L176, `switchList` L362, re-download M3U L405, `removeList` L470, `logout` L491,
  persistência cifrada L37-72, `apiBase` L126.
- `src/views/FTUE.vue` (179): texto legal versão 6 (`src/services/storage.js:20`); guarda
  `src/router/index.js:56-63`.
- `src/views/Login.vue` (264): DNS/usuário/senha + painéis de pareamento e inbox; `src/utils/urlSnippets.js`.
- `src/components/ListManagerModal.vue` (493): listas salvas.
- Testes-spec: `tests/authStore.test.js` (16), `tests/login.test.js` (6), `tests/legalLicense.test.js` (6),
  `tests/legalPairing.test.js` (9), `tests/router.test.js` (7), `tests/listManagerModal.test.js` (14),
  `tests/passwordFields.test.js` (2).

## Estado alvo
- `SessionManager` em `m.global` (substitui Pinia; resolve os ciclos auth↔catalog↔player —
  `research/dependency-map.md`).
- Telas: `FtueScreen` (mesmo texto legal), `LoginScreen` com **StandardKeyboardDialog/DynamicKeyboard** (cert. 4.12)
  para DNS, usuário e senha; atalhos de `urlSnippets`; `ListManagerScreen`.
- Fluxo de boot: FTUE aceito? → sessão hidratada? → home; senão login.
- Sem QR/código de licença em lugar nenhum dessas telas (Roku Pay — `00-roadmap.md`).

## Passos

### 1. SessionManager com regras de `authStore`
**Teste**: casos de `tests/authStore.test.js` portados (login, troca, remoção, logout, senha cifrada).

### 2. FTUE e roteamento inicial
**Teste**: e2e — primeira abertura mostra FTUE; aceitar leva ao login; relançar não mostra de novo; versão nova mostra.

### 3. Login e listas
**Teste**: e2e contra `npm run mock` — login ok/erro, lista M3U, trocar e remover lista.
**Rollback**: reverter commit. **Sucesso**: paridade com `tests/login.test.js` e `tests/listManagerModal.test.js`.

## Riscos
| Risco | Impacto | Mitigação | Evidência |
|---|---|---|---|
| Digitar DNS longo no controle | Médio | snippets de URL + teclado de voz; pareamento pelo celular (D9) | `src/utils/urlSnippets.js` |

## Dependências
Depende de D1, D2. Bloqueia D4, D5, D8.
