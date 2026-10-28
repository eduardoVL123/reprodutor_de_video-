# Política de Privacidade — Pulse Player

> **Rascunho técnico.** Preencha os campos entre `[colchetes]`, revise com seu jurídico e publique o texto
> em uma URL pública: Samsung Seller Office, LG Seller Lounge e Google Play exigem o link no cadastro.

Última atualização: [data]

## O que o aplicativo é

Pulse Player é um reprodutor de mídia genérico. Ele não fornece, hospeda, endossa ou vende conteúdo.
O usuário informa os endereços (servidor ou playlist) dos quais deseja reproduzir mídia e é o único
responsável por eles.

## Dados que o aplicativo trata

| Dado | Para quê | Onde fica |
| --- | --- | --- |
| Endereço do servidor, usuário e senha informados | Autenticar e reproduzir no servidor que o usuário escolheu | Somente no aparelho (armazenamento do app). A senha é cifrada com AES-GCM; a chave não sai do aparelho. Exceção: em lista M3U cujos links dos canais trazem usuário e senha, esses links ficam no catálogo, no histórico e na fila do aparelho sem cifra. |
| Catálogo (nomes, categorias, capas) baixado da lista do usuário | Mostrar canais, filmes e séries | Somente no aparelho |
| Perfis, favoritos, histórico de reprodução e buscas recentes | Funções do app por perfil | Somente no aparelho |
| Aceite do aviso legal (data e versão) | Comprovar o consentimento | Somente no aparelho |
| **Opcional, só se o usuário escolher "adicionar pelo celular":** a lista que ele cola no celular (endereço, usuário, senha e apelido), cifrada | Levar a lista do celular para a TV sem digitar no controle | Cifrada de ponta a ponta no celular; o serviço de pareamento guarda **só o texto cifrado**, na memória, por até 10 minutos (60 segundos depois que o celular envia) e o apaga assim que a TV o lê. Nunca em disco. |
| **Opcional, mesmo caso:** endereço de rede (IP) de quem usa o serviço de pareamento | Limitar abuso (muitas tentativas seguidas) | Contador na memória do serviço, por até 1 minuto; não é gravado em arquivo pelo serviço |
| **Opcional, só se o usuário enviar a lista pelo site:** a lista (endereço, usuário, senha e apelido), cifrada no navegador para a chave da TV | Levar a lista para a TV sem digitar no controle | A lista enviada pelo site é cifrada no navegador; o serviço de licença guarda **só o texto cifrado**, que não consegue abrir, por até **7 dias**, e o apaga assim que a TV o recebe. A TV pergunta antes de adicionar. |
| **Licença (teste grátis de 7 dias e ativação anual), quando o serviço está ligado no build:** identificador do aparelho (hash SHA-256 do ID do sistema ou da TV, ou um código aleatório criado pelo app), o código curto do aparelho, a plataforma (Android, Samsung, LG ou navegador), o **domínio** da lista em uso (só o nome do servidor; nunca usuário, senha nem o endereço completo) e as datas de uso | Controlar o teste de 7 dias e a ativação anual do aparelho e contar os aparelhos ativos por servidor parceiro, para a cobrança desse parceiro. Base legal (LGPD): execução do contrato de uso do app e legítimo interesse do desenvolvedor | No serviço de licença do desenvolvedor, por até **24 meses** (prazo de cobrança e contestação); depois é apagado. O endereço de rede (IP) é usado só em memória, por até 1 minuto, para limitar abuso. |
| **Opcional, só no celular, se o usuário tocar em "Transmitir":** endereço do vídeo (inclui usuário e senha da lista) e o título | Tocar o vídeo na TV escolhida (Chromecast / Google Cast) | Enviado pela rede local para o aparelho Google Cast escolhido, que busca o vídeo direto no servidor do usuário. O aplicativo não guarda nem envia isso a mais ninguém. |

## O que o aplicativo não faz

- Não envia dados pessoais, de uso ou de diagnóstico para o desenvolvedor ou para terceiros, **exceto** o que o
  próprio usuário escolher enviar pelo celular (item opcional da tabela acima), que viaja cifrado e só a TV dele
  consegue abrir, e os dados da licença descritos na tabela (identificador do aparelho, domínio da lista e datas de
  uso), que servem só ao teste, à ativação e à cobrança de servidores parceiros e nunca são vendidos.
- Não usa publicidade, rastreadores, análise de uso (analytics) nem cookies de terceiros.
- Não acessa contatos, localização, câmera ou microfone. (O celular só **lê** o QR code com o aplicativo de câmera
  do próprio aparelho; o Pulse Player não pede acesso à câmera.)

## Conexões de rede

O aplicativo só se conecta aos endereços que o usuário cadastrou (API, playlists, fluxos de vídeo e as imagens
de capa/logotipo que esses servidores indicam). Esses servidores são de terceiros e têm suas próprias
políticas; o aplicativo não controla o que eles registram.

Se o usuário escolher "Experimentar com vídeos de demonstração" no login, o aplicativo baixa a lista de
demonstração do endereço publicado pelo desenvolvedor e reproduz vídeos de uso livre e sinais públicos de teste
(Blender Foundation via archive.org, Mux e Apple). Nenhum dado do usuário é enviado nessa escolha.

### Adicionar lista pelo celular (opcional)

Quando a versão do aplicativo traz essa opção (a tela de login mostra "Use o seu celular"), o aplicativo conversa
com o **serviço de pareamento** do desenvolvedor, em [endereço do serviço de pareamento]:

1. A TV pede um código curto e envia ao serviço uma **chave pública** gerada na hora. A chave privada fica só na
   memória da TV e nunca sai dela.
2. O usuário abre a página do serviço no celular (pelo QR code ou digitando o endereço curto), cola o link da lista
   e toca em enviar. A página **cifra a lista no próprio celular** com a chave da TV (cifra de ponta a ponta);
   o serviço recebe apenas o texto cifrado.
3. A TV recolhe o texto cifrado, abre com a chave privada e **mostra o servidor recebido para o usuário confirmar**
   antes de adicionar. O serviço apaga o texto no mesmo instante da leitura; se ninguém o ler, ele some sozinho em
   no máximo 10 minutos (60 segundos depois do envio).

O serviço roda na infraestrutura do Cloudflare (Cloudflare Workers e Durable Objects), que
processa as requisições de rede (enxergando o endereço IP de quem acessa) conforme a política de
privacidade do provedor. A observabilidade e os logs do Worker ficam expressamente desligados na
configuração, de modo que nenhum corpo de requisição, chave ou segredo é gravado. O serviço não
consegue ler a lista, não grava o conteúdo em disco nem em banco e não usa cookies, anúncios ou
rastreadores; a página do celular não carrega nenhum recurso de terceiros. O serviço enxerga o
endereço de rede (IP) de quem o acessa unicamente para limitar abusos através de contadores em memória
volátil de até 1 minuto.

Quem não usa essa opção não envia nada ao serviço: a TV só o contacta quando a tela "Use o seu celular" está aberta.

### Transmitir para a TV (opcional, só no celular)

No aplicativo para celular e tablet Android, o player mostra "Transmitir" quando o aparelho tem Google Play
Services. Ao escolher uma TV com Google Cast (Chromecast ou TV compatível), o aplicativo envia pela rede local o
endereço do vídeo (que inclui o usuário e a senha da lista) e o título para essa TV. A TV abre o receptor padrão do
Google (Default Media Receiver) e busca o vídeo **direto no servidor do usuário**; o aplicativo não passa o vídeo por
nenhum servidor do desenvolvedor. A descoberta das TVs e a conexão são feitas pelo Google Play Services do aparelho,
conforme a política de privacidade do Google. Enquanto a transmissão estiver ativa, outros aparelhos na mesma rede
podem ver o que está tocando na TV. Quem não toca em "Transmitir" não envia nada para nenhuma TV.

## Controle e exclusão

- **Remover uma lista:** Dashboard → Listas → lixeira. Apaga a lista salva e a senha cifrada.
- **Sair da conta:** Dashboard → Listas → "Sair da conta atual". Encerra a sessão e apaga o catálogo em cache; as
  listas salvas continuam no aparelho até serem removidas pela lixeira.
- **Apagar tudo:** limpe os dados do aplicativo nas configurações do aparelho ou desinstale o aplicativo.
- **Pareamento pelo celular:** não há nada para apagar no serviço depois do uso (ele já apagou). Para cancelar antes,
  basta fechar a tela ou gerar um novo código na TV: o código antigo deixa de valer em no máximo 10 minutos.

## Crianças

O aplicativo não tem restrição de conteúdo por faixa etária: o conteúdo depende inteiramente das listas
cadastradas pelo usuário. Responsáveis devem supervisionar o uso.

## Contato

[nome do responsável] — [e-mail de contato]
