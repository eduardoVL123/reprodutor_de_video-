# Lista de demonstração

`pulse-demo.m3u` é a lista usada pelo botão "Experimentar com vídeos de demonstração" do login e informada aos
revisores das lojas (Samsung Seller Office → informações de teste; LG Seller Lounge). O app não traz conteúdo:
sem uma lista, o revisor não tem o que assistir.

Só entram vídeos de uso livre ou transmissões públicas de teste, sem logos:

| Item | Origem | Licença |
|---|---|---|
| Big Buck Bunny, Elephants Dream, Tears of Steel | Blender Foundation (via archive.org e Mux) | Creative Commons BY |

Para ativar o botão, publique este arquivo num endereço fixo (por exemplo, o link "raw" do GitHub) e gere o build com
`VITE_DEMO_PLAYLIST_URL=<endereço>` (no CI: variável do repositório `PULSE_DEMO_PLAYLIST_URL`).

Confira os endereços antes de cada envio às lojas: transmissões públicas de teste saem do ar sem aviso
(a da Akamai saiu em 10/2026; a de exemplo da Apple foi tirada em 10/2026 por demorar até 17 s na primeira abertura).

## Direção da lista de teste (decisão do dono, 2026-11-05)
A lista de demonstração deve mostrar o app como **reprodutor de uso geral**, não como app de IPTV. Os grupos imitam
quem usaria o app além de listas de TV:

| Grupo | Uso que representa | Exemplo de item |
|---|---|---|
| Hotel — Canais internos | TV dos quartos: boas-vindas, serviços, cardápio | "Boas-vindas ao hóspede", "Canal do restaurante" |
| Recepção e espera | Tela de recepção, consultório, salão | vídeo em laço |
| Empresa — Treinamentos | Integração de funcionários, comunicados | "Treinamento de segurança" |
| Escola e cursos | Aulas gravadas, palestras | "Aula 1 — Introdução" |
| Igreja e eventos | Transmissão de culto/evento ao vivo | canal ao vivo de teste |
| Academia | Telas de treino em laço | vídeo em laço |
| Filmes de demonstração | Acervo de filmes (Blender) | Big Buck Bunny, Elephants Dream, Tears of Steel |

Regras: só vídeos de uso livre (Creative Commons, domínio público como NASA) ou streams públicos de teste; nomes
fictícios de hotel/empresa (nada de marca real); capas próprias ou da obra livre, sempre com o crédito no nome.
