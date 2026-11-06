# Lista de demonstração

O botão **Experimentar com vídeos de demonstração** abre `pulse-demo.m3u`. A demonstração é isenta de ativação,
inclusive após os sete dias de teste. O endereço fixo é a variável `PULSE_DEMO_PLAYLIST_URL` do CI.

## Conteúdo da fase 1 (RFC-026)

| Grupo | Itens | Origem |
|---|---|---|
| Hotel — Canais internos | Boas-vindas ao hóspede, Serviços do hotel, Cardápio do restaurante | Pulse Player |
| Recepção e espera | Bem-vindo à recepção, Avisos e horários | Pulse Player |
| Empresa — Treinamentos | Integração de novos colaboradores, Treinamento de segurança | Pulse Player |
| Escola e cursos | Aula 1 — Introdução, Aula 2 — Prática | Pulse Player |
| Academia | Treino em laço — Alongamento | Pulse Player |
| Eventos e transmissões de demonstração | Big Buck Bunny — teste HLS, Tears of Steel — teste HLS | Blender Foundation, CC BY 3.0; streams de teste do Mux |
| Filmes de demonstração | Big Buck Bunny, Elephants Dream, Tears of Steel, Sintel — Trailer | Blender Foundation, CC BY |

São **16 itens, 7 grupos, 16 capas e 10 vídeos próprios**. Os dois HLS são filmes usados como streams de teste,
sem programação de TV. Por decisão do dono em 2026-11-06, mantemos os dois endereços existentes do Mux.
Sintel usa o trailer oficial pequeno para reduzir o tempo de abertura.

Os vídeos próprios têm 15 segundos, H.264 Main 720p/yuv420p, áudio AAC estéreo 44,1 kHz/96 kbps e `faststart`.
O áudio é um acorde sintetizado pelo gerador, com entrada e saída suaves. Textos em português e inglês, relógio
e barra de progresso permitem conferir imagem em movimento e som. Não há narração.

As capas dos filmes são recortes de quadros das obras, com identificação da demonstração e crédito.
Big Buck Bunny, Tears of Steel e Sintel são CC BY 3.0; Elephants Dream é CC BY 2.5.
Fontes dos créditos e licenças — [Big Buck Bunny](https://peach.blender.org/about/),
[Elephants Dream](https://orange.blender.org/), [Tears of Steel](https://mango.blender.org/sharing/),
[Sintel](https://durian.blender.org/about/). As capas são adaptações por recorte, escurecimento e texto.
Os títulos da lista mantêm os créditos originais. Os vídeos e cartazes próprios são material de demonstração do Pulse Player.

## Regeneração

Requer Node, `ffmpeg` e `ffprobe` no PATH. No Windows usa Arial instalada em `C:/Windows/Fonts/arial.ttf`.
Em outro ambiente, defina `DEMO_FONT` para o arquivo TrueType local.

```powershell
# PowerShell, na raiz do repositório
node scripts/make-demo-media.mjs --sample
node scripts/make-demo-media.mjs
```

O primeiro comando gera somente o vídeo e a capa de boas-vindas. O segundo gera todos os arquivos e a lista.
As capas dos filmes exigem rede para extrair um quadro de cada obra. O gerador confere com `ffprobe` as trilhas,
resolução, duração e limite de 1 MB por vídeo. Os arquivos resultantes ficam em `media/` e `capas/` e entram no Git,
sem exigir ffmpeg no CI. `tests/demoList.test.js` lê a lista real e confere capas, arquivos, grupos e streams.

## Publicação e validação no aparelho

Os endereços da lista apontam para `main` no GitHub. Os novos arquivos só estarão acessíveis por esses endereços
depois de publicar a lista, `media/` e `capas/` juntos. A lista mantém a URL de build atual, preservando a isenção da licença.
Uma sessão M3U já aberta pode precisar de atualização da lista para buscar o catálogo novo.

Antes de publicar, testar um clipe com som no celular e na TV. Medir tempo até o primeiro quadro e conferir
`Content-Type` e Range na hospedagem. A hospedagem GitHub ainda depende desse teste físico.
Se falhar, a alternativa prevista na RFC é hospedar em `/demo/` no site, ajustando os endereços dos arquivos.
Uma URL de playlist em branch diferente da configurada no build exige aparelho ativado para esse teste,
pois a isenção vale para a URL exata da demonstração.

O aviso **Esta lista não tem séries** é alteração do app e entrará no próximo APK/AAB quando o dono pedir.
As séries de demonstração por Xtream pertencem à fase 2.

## Conferir links antes de cada envio

```powershell
# PowerShell, na raiz do repositório. Após publicar os arquivos, incluir também os URLs próprios.
Get-Content docs/demo/pulse-demo.m3u | Where-Object { $_ -match '^https://' } | ForEach-Object {
  Write-Host $_
  curl.exe -sS -I -L --max-time 20 $_
}
```

Conferir 200/206, tipo de conteúdo e suporte a Range. Para cada HLS, conferir também uma variante e um segmento
de mídia e tocar no aparelho. Links públicos podem mudar ou sair do ar. Capas e vídeos próprios publicados
também precisam ser conferidos. O teste automatizado local não substitui a reprodução na TV e no celular.
