# D1 — Cliente Xtream/M3U e URLs de stream

## Estado atual
- `src/services/xtreamApi.js` (456): `buildApiUrl` L59-69, downgrade https→http L94-100/123-135, `authenticate`
  L241-302 (retry `:8080` L225-234, valida `auth=='1'` L283 e `status=='active'` L287), `fetchSeriesInfo` L144-160,
  `fetchVodInfo` L206-223, `fetchM3uText` L307-327, `resolveShortInput` L349-456.
- `src/services/xtreamTransport.js` (177): timeouts 15 s/90 s L6-7, `readJson` L146-177, leitura em streaming L92-143.
- `src/services/xtreamErrors.js`: `ERROR_CODES` L13-27, mensagens em português.
- `src/services/m3uParser.js` (202): classificação VOD L105-110, ids djb2 L113-128.
- `src/utils/jsonArrayReader.js` (91); `src/services/streamUrl.js` (92) — live `.m3u8`→`.ts` L53-61, VOD L63-79.
- Testes-spec: `tests/xtreamApi.test.js` (21), `tests/m3uGroups.test.js` (13), `tests/streamUrl.test.js` (2),
  `tests/jsonArrayReader.test.js` (4), `tests/demoList.test.js` (1), `tests/maskSecrets.test.js` (1).

## Estado alvo
- `roku/source/xtream/` (funções puras: montar URL, interpretar resposta, mapear erro, parse M3U, montar URL de stream)
  + `XtreamTask` (componente Task com `roUrlTransfer` assíncrono, `SetCertificatesFile`).
- Downloads grandes com `AsyncGetToFile` para `tmp:` e parse no Task (sem leitor incremental — ver D4).
- Live na Roku: usar só `.m3u8` como principal; `.ts` só se o spike da Fase 0 provar que funciona (R6).

## Passos

### 1. Portar funções puras com seus testes
**Pattern**: porta função por função, teste primeiro (skill `code-migration`).
**O que muda**: Rooibos com os mesmos casos de `tests/xtreamApi.test.js`, `tests/streamUrl.test.js`,
`tests/m3uGroups.test.js`; depois o código.
**Rollback**: reverter commit. **Sucesso**: todos os casos portados verdes; mensagens de erro iguais às do web.

### 2. Transporte em Task
**O que muda**: `XtreamTask` com timeout por requisição, retry `:8080`, downgrade https→http nas mesmas condições.
**Teste**: e2e contra `npm run mock` (teste123/senha123): login ok, senha errada, servidor fora, lista M3U.
**Sucesso**: os 4 cenários com as mesmas mensagens do app web.

### 3. URLs de stream
**O que muda**: `buildStreamUrl` e escolha de `streamFormat` (`hls`/`mp4`/`mkv`).
**Teste**: casos de `tests/streamUrl.test.js` + tabela extensão→`streamFormat`.

## Riscos
| Risco | Impacto | Mitigação | Evidência |
|---|---|---|---|
| TS cru não toca (R6) | Médio | `.m3u8` primeiro; erro claro | `research/stack-research.md`, "Vídeo" |
| Sem `fetch` com stream | Médio | `AsyncGetToFile` + parse no Task | `src/services/xtreamTransport.js:92-143` |

## Dependências
Depende de D0. Bloqueia D3, D4, D6.
