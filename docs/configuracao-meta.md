# Configuração — Fernando Oliveira Advocacia

| Item | Valor |
|---|---|
| Instagram | [@advfernandooliveira](https://www.instagram.com/advfernandooliveira/) |
| WhatsApp do escritório | +55 61 99165-8755 (hoje no app WhatsApp Business) |
| Identificação na IA | Fernando Oliveira Advocacia · OAB/DF 70.620 |
| Modo de operação do WhatsApp | **Coexistência**: app no celular + API no mesmo número |

Legenda: ✅ confirmado na documentação · ⚠️ confirmar durante o cadastro.

---

## Como o número em coexistência funciona no sistema

- **Clientes atuais não são afetados.** A IA só atende quem chegou por um link de post ou anúncio rastreado (`IA_SOMENTE_ORIGEM_RASTREADA=1`). As mensagens de outros contatos **não são guardadas nem marcadas como lidas**: você continua respondendo pelo app como hoje.
- **Você assume quando quiser.** Respondeu um lead pelo app no celular? A Meta avisa o sistema (webhook `smb_message_echoes`) e a IA para de responder aquele lead.
- **Você vê tudo no app.** As mensagens da IA aparecem na conversa do WhatsApp Business. Por isso não há aviso separado de "novo lead" (`ADVOGADO_WHATSAPP` vazio).
- **Limitações da coexistência (fontes de terceiros, ⚠️):**
  - só sincroniza mensagens novas;
  - o app precisa ser aberto pelo menos a cada 13 dias;
  - a vazão máxima é de 20 mensagens por segundo;
  - não há selo de conta oficial;
  - a disponibilidade no Brasil não está confirmada.
  - Fontes: [Woztell](https://support.woztell.com/portal/en/kb/articles/coexistence-whatsapp), [seven.io](https://help.seven.io/en/whatsapp/whatsapp-coexistence), [360dialog](https://docs.360dialog.com/docs/waba-basics/phone-numbers/coexistence/coexistence-webhooks).

---

## Parte A — Contas (feito por você, ~30 min)

1. **Instagram**: confirme que @advfernandooliveira é conta **profissional** (Empresa ou Criador de conteúdo) e **pública**. Webhooks de comentários exigem conta pública ✅.
2. **Meta Business Manager** ([business.facebook.com](https://business.facebook.com)): crie ou use o portfólio "Fernando Oliveira Advocacia" e inicie a **verificação da empresa** (CNPJ ou dados do escritório). A verificação libera nome de exibição e limites maiores ⚠️.
3. **App WhatsApp Business** no celular: atualize para a versão **2.24.17 ou superior**, exigida para a coexistência ⚠️.
4. **Política de privacidade** publicada num link (site ou página simples). A Meta exige esse link para colocar o app no ar ✅.

## Parte B — App na Meta (posso te guiar em uma chamada de tela)

5. Em [developers.facebook.com](https://developers.facebook.com) ➜ **Criar app** ➜ tipo **Empresa**, vinculado ao portfólio do escritório.
6. **Produto Instagram** ➜ "API com login do Instagram":
   - Adicione @advfernandooliveira e gere o token. Ele vai em `INSTAGRAM_ACCESS_TOKEN`; o ID da conta vai em `INSTAGRAM_ACCOUNT_ID`.
   - Permissões: `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages` ✅.
   - O token de longa duração do Instagram expira e precisa ser renovado periodicamente ⚠️. Vou automatizar isso na próxima etapa.
7. **Produto WhatsApp** ➜ adicionar número. Aqui há dois caminhos:
   - **Caminho 1 (coexistência, o que você escolheu):** a conexão do número do app é feita pelo *Embedded Signup*, que a Meta documenta para **parceiros de tecnologia (Tech Provider) ou provedores (BSP)** ⚠️. Se o painel do seu app oferecer "conectar número do WhatsApp Business app", use essa opção. Se não oferecer, há duas alternativas:
     - (a) usar um provedor que faz a coexistência e mantém o acesso à Cloud API (ex.: 360dialog, YCloud, Telnyx). Tem mensalidade, e talvez eu precise adaptar o envio;
     - (b) cadastrar o app como Tech Provider (mais burocracia e revisão da Meta).
   - **Caminho 2 (alternativa simples):** um **chip novo** só para a IA, ligado direto na Cloud API, sem intermediário. O 61 99165-8755 continua no app e recebe os avisos de lead (`ADVOGADO_WHATSAPP=5561991658755`).
8. **Webhooks**:
   - WhatsApp: URL `https://SEU-DOMINIO/webhook/whatsapp`, campos **`messages`** e **`smb_message_echoes`**.
   - Instagram: URL `https://SEU-DOMINIO/webhook/instagram`, campos **`comments`** e **`messages`**.
   - Token de verificação: o mesmo de `META_VERIFY_TOKEN`.
9. Coloque o app em **modo Live** (webhooks só chegam assim ✅) e envie as permissões para a **Análise do app**. Para os webhooks de comentários pode ser exigido *Advanced Access* ⚠️.

## Parte C — Servidor

10. Escolha onde hospedar (VPS, Render ou Railway com disco persistente) e um endereço HTTPS, ex.: `leads.seudominio.com.br`.
11. Preencha o `.env` **no servidor** (nunca mande tokens pelo chat):
    - `ANTHROPIC_API_KEY`: [console.anthropic.com](https://console.anthropic.com). É separada da assinatura do Claude ✅.
    - `META_ACCESS_TOKEN` (usuário do sistema), `META_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`.
    - `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_ACCOUNT_ID`.
    - `ADMIN_TOKEN`: uma senha longa para o painel.

## Parte D — Homologação (antes de qualquer pessoa real)

12. `MODO_HOMOLOGACAO=1`, com o seu Instagram pessoal em `INSTAGRAM_TESTE` e um WhatsApp pessoal (diferente do escritório) em `WHATSAPP_TESTE`.
13. Com o perfil pessoal, comente num post do @advfernandooliveira: *"trabalhei na roça e o INSS negou minha aposentadoria"*.
14. No painel: cole o link do post com o código `AR002` e aprove a mensagem. Confira se ela chegou no seu Direct.
15. Clique no link e converse no WhatsApp até o caso ser encaminhado. Teste também:
    - "SAIR" e "quero falar com o advogado";
    - responder pelo app no celular, para conferir que a IA para;
    - uma mensagem de outro número sem link, para conferir que a IA **não** responde.
16. Tudo certo ➜ `MODO_HOMOLOGACAO=0`.
