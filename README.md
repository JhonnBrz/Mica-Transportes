# Mica Transportes — protótipo do novo site

Landing page estática (HTML, CSS e JavaScript puros, sem dependências nem build).

## Ver localmente

```bash
python3 -m http.server 4173
```

Abra http://localhost:4173. É preciso servir por HTTP: abrir o `index.html` direto do disco impede o vídeo do hero de carregar em alguns navegadores.

## Estrutura

- `index.html`, `css/styles.css`, `js/main.js`
- `assets/hero/`: vídeo em loop do hero (`hero.mp4`) e imagem de capa
- `assets/img/`: logo da Mica, fotos dos serviços e logo do estúdio

## Antes de publicar de verdade

- O HTML tem `<meta name="robots" content="noindex, nofollow">`; remova para o Google indexar o site.
- O vídeo do hero foi gerado por IA e mostra um logotipo diferente do oficial da Mica no baú: trocar por filmagem real da frota.
- Não há formulário nem credenciais: os contatos são links de WhatsApp, telefone e e-mail.
