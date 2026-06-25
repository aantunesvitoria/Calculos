# Pré-briefing de interiores, obras e decoração

Estrutura inicial de uma página simples para o cliente preencher um pré-briefing. O cliente recebe apenas a confirmação de envio. Os cálculos, feedbacks e relatório em PDF ficam salvos no servidor, sem aparecer para o cliente.

## Como rodar localmente

1. Instale as dependências:

```bash
npm install
```

2. Crie o arquivo `.env` com base no `.env.example`.

3. Rode o servidor:

```bash
npm run dev
```

4. Acesse:

```text
http://localhost:3000
```

## Publicação

Este projeto tem duas partes:

- `public/`: landing page estática, compatível com GitHub Pages.
- `server.js`: servidor Node responsável por gerar PDFs, WhatsApp e área administrativa.

O GitHub Pages publica apenas a landing page estática por GitHub Actions. Para usar envio de briefing, geração de PDF e `/admin`, rode o servidor Node localmente ou publique em uma hospedagem que execute Node.js.

## Hospedagem gratuita do servidor

O projeto está pronto para Render usando `render.yaml`.

1. Acesse `https://render.com/`.
2. Entre com sua conta GitHub.
3. Crie um novo serviço por Blueprint.
4. Escolha o repositório `aantunesvitoria/Calculos`.
5. Confirme o plano Free.

Depois que o Render gerar a URL do serviço, edite `public/config.js` e coloque essa URL em `serverUrl`. Exemplo:

```js
window.APP_CONFIG = {
  serverUrl: "https://seu-servico.onrender.com"
};
```

Faça commit e push dessa alteração para que o GitHub Pages use o servidor publicado.

Observação: no plano Free do Render, o serviço pode "dormir" depois de alguns minutos sem acesso e levar cerca de um minuto para acordar na próxima visita.

## WhatsApp

Por padrão, `WHATSAPP_DRY_RUN=true` apenas mostra a mensagem no terminal. Para envio real, configure:

- `WHATSAPP_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_TO`
- `WHATSAPP_DRY_RUN=false`

O envio real usa a WhatsApp Cloud API da Meta. As regras de template, janela de conversa e permissão do número precisam estar configuradas na conta da Meta.

## Relatórios em PDF

Quando o cliente envia o briefing, o servidor cria automaticamente um PDF na pasta local `reports/`.

Para acessar os PDFs, abra:

```text
http://localhost:3000/admin
```

Login padrão:

```text
admin
```

Senha padrão:

```text
admin123
```

Para trocar a senha, crie ou edite o arquivo `.env`:

```env
ADMIN_PASSWORD=sua-senha-aqui
```

## Google Drive opcional

A integração com Google Drive continua possível, mas não é necessária para o fluxo básico. O modo prático atual salva os PDFs diretamente no servidor.

## Onde ajustar os cálculos

Os cálculos e feedbacks internos ficam em `server.js`, na função `calculateReport`. O texto enviado para o WhatsApp fica em `buildWhatsAppMessage`.
