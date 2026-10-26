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
