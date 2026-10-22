# lead-prev — Gerador de leads para Direito Previdenciário

Instagram ➜ WhatsApp Business ➜ triagem por IA (Claude) ➜ advogado.

```
 Post no Instagram ──► comentário "quero" ──► DM automática com link do WhatsApp (ref do post)
        │                                         │
        └── link na legenda/bio/stories ──────────┤
        └── anúncio "Clique para o WhatsApp" ─────┤
                                                  ▼
                                   WhatsApp Business (Cloud API)
                                                  ▼
                       IA faz a triagem: área, dados, consentimento LGPD
                                                  ▼
                      Lead qualificado ──► aviso no WhatsApp do advogado
                                         (a IA para e o humano assume)
                      Lead parou de responder ──► follow-up por template
```

## O que ele faz

| Recurso | Como funciona |
|---|---|
| **Vínculo com os posts** | Cada post vira uma *campanha* em `data/campanhas.json`, com uma `ref` (ex.: `BPC01`). O link `wa.me` leva `(ref:BPC01)` no texto, então todo lead fica marcado com o post de origem. Anúncios "Clique para o WhatsApp" também são reconhecidos (campo `referral`). |
| **Comentário ➜ Direct** | Quem comenta uma palavra-chave (ex.: "quero", "bpc") recebe uma resposta privada no Direct com o link do WhatsApp, e o comentário recebe uma resposta pública curta ("Te chamei no direct!"). |
| **IA no WhatsApp e no Direct** | O Claude conversa com o lead, se apresenta como assistente virtual, pede o consentimento LGPD, coleta os dados certos para cada benefício (BPC/LOAS, aposentadoria, auxílio por incapacidade, pensão, revisão...) e classifica o caso. |
| **Passagem para o advogado** | Quando o caso está qualificado (ou a pessoa pede um humano, ou há prazo urgente), a IA para de responder e o advogado recebe no WhatsApp um resumo com o link da conversa. |
| **Follow-up** | `npm run followup` reenvia um template aprovado para quem parou de responder, no máximo 2 vezes, só para quem deu consentimento e não pediu para sair. |
| **Painel** | `/leads?token=...` lista todos os leads com origem, área, status e resumo. |

## ⚖️ Ética da OAB e LGPD — leia antes de ligar

- **Provimento 205/2021 da OAB**: a publicidade deve ser informativa. A IA está instruída a **não prometer resultado, não falar de honorários e não dar parecer**. Revise o prompt em `src/ia.js` com o seu olhar de advogado(a).
- **Nada de disparo em massa para quem não pediu.** O sistema só responde quem iniciou o contato (comentou, mandou direct ou mensagem no WhatsApp). Comprar listas e disparar mensagens fere a OAB, a LGPD e as regras do WhatsApp (o número é banido).
- Dados de saúde são **dados sensíveis** (LGPD, art. 11): a IA pede consentimento antes de perguntar sobre doenças. Tenha uma política de privacidade publicada.
- A IA se identifica como atendimento automatizado.

## Passo a passo

### 1. Contas necessárias
1. **Meta Business Manager** (business.facebook.com) com o escritório verificado.
2. **Instagram profissional** (comercial ou criador) ligado a uma Página do Facebook.
3. **App na Meta** (developers.facebook.com ➜ Criar app ➜ tipo *Empresa*) com os produtos **WhatsApp** e **Instagram** (API do Instagram com login do Instagram).
4. **Número de WhatsApp** dedicado para a Cloud API (o número não pode estar em uso no app WhatsApp comum ao mesmo tempo).
5. **Chave da API do Claude** em console.anthropic.com.

### 2. Instalação
```bash
npm install
cp .env.example .env     # preencha as variáveis
npm test
npm start
```
Requer Node.js 22.13 ou superior.

### 3. Teste a IA antes de conectar à Meta
Só com a `ANTHROPIC_API_KEY` preenchida:
```bash
npm run simular -- BPC01
```
Você conversa no terminal como se fosse um lead que veio do post BPC01. Ajuste o prompt até gostar das respostas.

### 4. Publicar o servidor
A Meta precisa de uma URL **https** pública. Opções: Render, Railway, Fly.io, uma VPS, ou `ngrok http 3000` para testes.
O banco é um arquivo SQLite em `data/leads.db` — use um disco persistente na hospedagem.

### 5. Webhooks na Meta
No painel do app:
- **WhatsApp ➜ Configuração ➜ Webhook**: URL `https://SEU-DOMINIO/webhook/whatsapp`, token de verificação = `META_VERIFY_TOKEN`. Assine o campo `messages`.
- **Instagram ➜ Webhooks**: URL `https://SEU-DOMINIO/webhook/instagram`, mesmo token. Assine `comments` e `messages`.
- Permissões do Instagram: `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`.
- Permissões do WhatsApp: `whatsapp_business_messaging`, `whatsapp_business_management`. Gere um token permanente com um *Usuário do sistema*.
- Para atender o público (não só contas de teste), o app precisa passar pela **Análise do app** da Meta.

### 6. Ligar os posts às campanhas
1. Publique o post. Pegue o **ID da mídia** (Graph API: `GET /{ig-user-id}/media`) e coloque em `postIds` da campanha em `data/campanhas.json`.
2. Gere os links do WhatsApp de cada campanha:
   `GET https://SEU-DOMINIO/campanhas/links?token=SEU_ADMIN_TOKEN`
3. Na legenda, escreva a chamada: *"Comente QUERO que eu te mando no direct como saber se você tem direito ao BPC"*. Use o link no stories/bio/anúncio.

### 7. Template de follow-up
Em **WhatsApp ➜ Modelos de mensagem**, crie um modelo categoria *Utilidade* chamado `retomar_atendimento` (pt_BR), por exemplo:
> Olá, {{1}}! Ficou alguma dúvida sobre a análise do seu caso no INSS? Se quiser continuar, é só responder esta mensagem. Se não quiser mais receber mensagens, responda SAIR.

Agende `npm run followup` para rodar de hora em hora (cron da hospedagem).

### 8. Aviso ao advogado
Coloque o seu WhatsApp pessoal em `ADVOGADO_WHATSAPP`. Mande um "oi" para o número do escritório uma vez por dia (a Cloud API só envia texto livre dentro da janela de 24h) — ou troque o aviso por um template, e-mail ou integração com o seu CRM em `avisarAdvogado` (`src/atendimento.js`).

## Rotas administrativas
Todas pedem `?token=ADMIN_TOKEN` ou `Authorization: Bearer ADMIN_TOKEN`.

| Rota | O quê |
|---|---|
| `GET /leads` | Painel em HTML (ou JSON com `Accept: application/json`) |
| `GET /leads/:id/conversa` | Histórico da conversa |
| `POST /leads/:id/ia` `{"ativa": false}` | Pausa a IA (você assume) ou religa |
| `POST /leads/:id/mensagem` `{"texto": "..."}` | Envia mensagem manual pelo número do escritório |
| `GET /campanhas/links` | Links wa.me de cada post |

## Estrutura
```
src/server.js       webhooks + painel
src/whatsapp.js     interpreta mensagens do WhatsApp (inclui anúncios Click-to-WhatsApp)
src/instagram.js    comentários ➜ resposta privada; Direct ➜ IA
src/atendimento.js  fila por lead, chama a IA, envia, passa para o advogado
src/ia.js           prompt de triagem previdenciária e chamada ao Claude
src/meta.js         chamadas à Graph API (WhatsApp/Instagram) e validação de assinatura
src/db.js           SQLite (leads, mensagens)
scripts/followup.js reengajamento por template
scripts/simular.js  conversa de teste no terminal
data/campanhas.json posts/campanhas
```
