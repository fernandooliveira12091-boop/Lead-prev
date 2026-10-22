# lead-prev — Gerador de leads para Direito Previdenciário

> ⚠️ **Status:** funcional em **modo homologação** (só envia para contas de teste). Antes de atender o público, faça a etapa 6 do passo a passo.
> Configuração específica do escritório: [`docs/configuracao-meta.md`](docs/configuracao-meta.md).
> Esta versão usa Node.js + SQLite; a migração para n8n + PostgreSQL da especificação está planejada.
> A especificação e o plano por fases estão em [`docs/fase-1-descoberta.md`](docs/fase-1-descoberta.md); o esquema PostgreSQL do MVP está em [`db/migrations/`](db/migrations/).

Você manda o post ➜ o sistema acha os leads quentes nos comentários ➜ você aprova ➜ a pessoa vai para o WhatsApp ➜ a IA faz a triagem ➜ o caso chega ao advogado.

```
 Você cola o link do post/anúncio no painel
          ▼
 API oficial do Instagram busca os comentários
          ▼
 IA classifica: 🔴 quente · 🟠 morno · ⚪ frio · fora do escopo
          ▼
 Você revisa a mensagem e clica "Aprovar e enviar"
          ▼
 1 resposta privada no Direct com link do WhatsApp (código do post)
          ▼
 A pessoa chama no WhatsApp ➜ IA faz a triagem ➜ aviso ao advogado
```

## Como usar no dia a dia

1. Abra `https://SEU-DOMINIO/painel` e entre com o usuário e a senha do `.env`.
2. Cole o **link do post ou reel** (ou o **ID da mídia**, no caso de anúncio que não aparece no perfil) e dê um **código** (ex.: `AR001`).
3. O sistema lista os comentários, os quentes primeiro, com a mensagem privada e a resposta pública já sugeridas.
4. Ajuste o texto, se quiser, e clique em **Aprovar e enviar**. Comentários novos chegam sozinhos pelo webhook e entram na mesma fila.
5. Quem clicar no link cai no WhatsApp do escritório com o código do post. A IA faz a triagem, uma pergunta por vez, e passa o caso ao advogado.

Pelo terminal: `npm run analisar-post -- https://www.instagram.com/p/XXXX/ AR001 "Aposentadoria rural negada"`.

### Limites (regras da Meta, não do sistema)

- **Só posts e anúncios da conta do escritório.** A API oficial não entrega comentários de perfis de terceiros, e coletá-los por scraping viola os termos da Meta, a LGPD e o Provimento 205/2021.
- **Uma resposta privada por comentário, em até 7 dias.** Depois disso, o painel marca como "expirado".
- **Nada sai sem a sua aprovação.** E, enquanto `MODO_HOMOLOGACAO=1`, nada sai para quem não estiver em `INSTAGRAM_TESTE`/`WHATSAPP_TESTE`.

## O que mais ele faz

| Recurso | Como funciona |
|---|---|
| **Vínculo com os posts** | O link `wa.me` leva `(ref:AR001)` no texto, então o lead fica marcado com o post de origem. Anúncios "Clique para o WhatsApp" também são reconhecidos (campo `referral`). |
| **IA no WhatsApp e no Direct** | O Claude se apresenta como assistente virtual, pede o consentimento LGPD e faz as perguntas de cada benefício (com roteiro para aposentadoria rural e salário-maternidade rural), uma por vez. |
| **Parar e falar com humano** | "SAIR", "PARAR" etc. interrompem a automação na hora, sem passar pela IA. "Atendente" ou "falar com o advogado" passa o caso para a equipe. |
| **Passagem para o advogado** | Caso qualificado, complexo ou urgente: a IA para de responder e o advogado recebe um resumo. |
| **Painel de leads** | `/leads` lista os leads com origem, área, status e resumo. |

## ⚖️ Ética da OAB e LGPD — leia antes de ligar

- **Provimento 205/2021 da OAB**: a publicidade deve ser informativa. A IA está instruída a **não prometer resultado, não falar de honorários e não dar parecer**. Revise o prompt em `src/ia.js` com o seu olhar de advogado(a).
- **Nada de disparo em massa para quem não pediu.** O sistema só fala com quem interagiu com o escritório (comentou no seu post, mandou direct ou WhatsApp), e a primeira mensagem depende da sua aprovação. Comprar listas, raspar perfis alheios e disparar mensagens fere a OAB, a LGPD e as regras do WhatsApp (o número é banido).
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
npm run simular -- AR001
```
Você conversa no terminal como se fosse um lead que veio do post AR001. Ajuste o prompt (`src/ia.js`) até gostar das respostas.

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

### 6. Homologação (obrigatória antes de atender o público)
1. Deixe `MODO_HOMOLOGACAO=1` e coloque o seu Instagram pessoal em `INSTAGRAM_TESTE` e o seu WhatsApp em `WHATSAPP_TESTE`.
2. Com o seu perfil pessoal, comente num post do escritório: *"trabalhei na roça e o INSS negou"*.
3. No painel, analise o post, aprove a mensagem e confira se ela chegou no seu Direct com o link.
4. Clique no link, mande a mensagem no WhatsApp e converse com a IA até o caso ser encaminhado. Teste também "SAIR" e "quero falar com o advogado".
5. Só depois disso mude para `MODO_HOMOLOGACAO=0`.

### 7. Template de follow-up (opcional, não recomendado no início)
Mensagens fora da janela de 24h exigem opt-in explícito para esse tipo de mensagem. Só use depois de definir isso com cuidado.
Em **WhatsApp ➜ Modelos de mensagem**, crie um modelo categoria *Utilidade* chamado `retomar_atendimento` (pt_BR), por exemplo:
> Olá, {{1}}! Ficou alguma dúvida sobre a análise do seu caso no INSS? Se quiser continuar, é só responder esta mensagem. Se não quiser mais receber mensagens, responda SAIR.

Agende `npm run followup` para rodar de hora em hora (cron da hospedagem).

### 8. Aviso ao advogado
Coloque o seu WhatsApp pessoal em `ADVOGADO_WHATSAPP`. Mande um "oi" para o número do escritório uma vez por dia (a Cloud API só envia texto livre dentro da janela de 24h) — ou troque o aviso por um template, e-mail ou integração com o seu CRM em `avisarAdvogado` (`src/atendimento.js`).

## Rotas administrativas
Todas pedem login (usuário/senha do painel) ou `Authorization: Bearer ADMIN_TOKEN`.

| Rota | O quê |
|---|---|
| `GET /leads` | Painel em HTML (ou JSON com `Accept: application/json`) |
| `GET /leads/:id/conversa` | Histórico da conversa |
| `POST /leads/:id/ia` `{"ativa": false}` | Pausa a IA (você assume) ou religa |
| `POST /leads/:id/mensagem` `{"texto": "..."}` | Envia mensagem manual pelo número do escritório |
| `GET /campanhas/links` | Links wa.me de cada post |

## Estrutura
```
src/server.js       webhooks + rotas
src/painel.js       painel: analisar post, aprovar/ignorar comentários (login HTTP Basic)
src/posts.js        busca comentários, classifica, envia resposta privada aprovada
src/classificador.js IA que classifica comentários (quente/morno/frio/fora do escopo)
src/whatsapp.js     interpreta mensagens do WhatsApp (inclui anúncios Click-to-WhatsApp)
src/instagram.js    webhook: comentários ➜ fila do painel; Direct ➜ IA
src/atendimento.js  fila por lead, chama a IA, envia, passa para o advogado
src/ia.js           prompt de triagem previdenciária e chamada ao Claude
src/meta.js         Graph API (WhatsApp/Instagram), assinatura e trava do modo homologação
src/db.js           SQLite (leads, mensagens, posts, comentários)
scripts/analisar-post.js  análise de post pelo terminal
scripts/followup.js reengajamento por template
scripts/simular.js  conversa de teste no terminal
data/campanhas.json posts/campanhas
```
