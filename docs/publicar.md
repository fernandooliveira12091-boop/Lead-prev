# Publicar o painel na Railway — passo a passo

Ao final você terá o painel em um endereço como `https://lead-prev-production.up.railway.app/painel`, protegido por login e em **modo homologação** (não envia mensagem para ninguém). A conexão com Instagram, WhatsApp e IA vem depois, na mesma tela de variáveis.

Tempo estimado: 20 minutos. Você precisa de um computador (pelo celular é difícil) e do login do GitHub onde está o repositório `lead-prev`.

---

## 1. Criar a conta na Railway

1. Acesse **[railway.com](https://railway.com)** e clique em **Login** ➜ **Continue with GitHub**.
2. Entre com a conta do GitHub dona do repositório (`fernandooliveira12091-boop`) e autorize a Railway.
3. Assine o plano **Hobby** (menu do seu perfil ➜ *Account* / *Plans*). O banco de dados precisa de **volume** (disco permanente), recurso disponível no plano pago. Confira o valor atual na [página de preços](https://railway.com/pricing) antes de assinar.

## 2. Criar o projeto a partir do GitHub

1. No painel da Railway: **New Project** ➜ **Deploy from GitHub repo**.
2. Se o repositório `lead-prev` não aparecer, clique em **Configure GitHub App** e libere o acesso a ele. Depois volte e selecione.
3. A Railway começa a publicar sozinha. Pode deixar; vamos ajustar nos próximos passos.

## 3. Escolher a versão certa do código

O código mais recente está na branch **`analise-de-posts`**.

1. Clique no serviço (o quadro com o nome `lead-prev`) ➜ aba **Settings**.
2. Em **Source** ➜ **Branch**, escolha `analise-de-posts`.

## 4. Criar o disco permanente (volume)

Sem isso, todos os leads são apagados a cada atualização.

1. Na tela do projeto (o "canvas"), clique com o botão direito no serviço ➜ **Attach Volume**. Outra opção: botão **+ New** ➜ **Volume**, escolhendo o serviço `lead-prev`.
2. Em **Mount path**, escreva exatamente: `/data`

## 5. Configurar as variáveis

1. No serviço ➜ aba **Variables** ➜ **Raw Editor**.
2. Cole o bloco abaixo e **substitua os dois valores entre `< >`**:

```
DB_PATH=/data/leads.db
ADMIN_TOKEN=<crie uma senha longa, ex.: 4 palavras aleatórias + números>
PAINEL_USUARIO=fernando
MODO_HOMOLOGACAO=1
IA_SOMENTE_ORIGEM_RASTREADA=1
ESCRITORIO_NOME=Fernando Oliveira Advocacia
ADVOGADO_NOME=Fernando Oliveira
OAB=OAB/DF 70.620
INSTAGRAM_USUARIO=advfernandooliveira
WHATSAPP_NUMERO=5561991658755
META_VERIFY_TOKEN=<crie um texto aleatório, ex.: verifica-lead-8f3k2>
TZ=America/Sao_Paulo
```

3. Clique em **Update Variables** e depois em **Deploy**, se a Railway pedir.

> 🔒 Guarde a senha (`ADMIN_TOKEN`) num gerenciador de senhas. **Não envie essa senha nem nenhum token pelo chat**, nem para mim.

## 6. Gerar o endereço público

1. No serviço ➜ **Settings** ➜ **Networking** ➜ **Generate Domain**.
2. A Railway mostra um endereço terminado em `.up.railway.app`. Se ela perguntar a porta, deixe a sugerida: o sistema usa a variável `PORT` que a própria Railway define.

## 7. Conferir se está no ar

1. Abra `https://SEU-ENDERECO.up.railway.app/saude`. Deve aparecer `{"ok":true}`.
2. Abra `https://SEU-ENDERECO.up.railway.app/painel`. O navegador pede usuário e senha:
   - usuário: `fernando` (o valor de `PAINEL_USUARIO`);
   - senha: o valor de `ADMIN_TOKEN`.
3. Deve aparecer o painel com a faixa amarela **"Modo homologação ligado"**.
4. Na aba **Deployments** ➜ **View Logs**, as linhas devem incluir:
   - `Modo homologação: ligado`
   - `lead-prev ouvindo na porta ...`
   - e **não** devem incluir `ATENÇÃO: DB_PATH fora do volume`. Se incluir, revise os passos 4 e 5.

Pronto: o painel está publicado. Enquanto o Instagram não estiver conectado, colar o link de um post mostra a mensagem *"Token do Instagram não configurado"*. É o esperado.

---

## Se algo der errado

| Sintoma | O que fazer |
|---|---|
| Deploy falhou ("Build failed") | Em **Deployments** ➜ **View Logs**, copie as últimas linhas **sem** variáveis/senhas e me mande |
| `/painel` pede senha e não aceita | Confira `PAINEL_USUARIO` e `ADMIN_TOKEN` nas Variables (maiúsculas, espaços no fim) |
| Leads somem após atualizar | O volume não está montado em `/data` ou `DB_PATH` está diferente de `/data/leads.db` |
| "Application failed to respond" | Aguarde 1 minuto após o deploy; se continuar, mande os logs |

## Próximas etapas (depois que o painel estiver no ar)

1. **Domínio próprio** (opcional): em **Settings** ➜ **Networking** ➜ **Custom Domain**, ex.: `leads.seudominio.com.br`. A Railway mostra o registro DNS a criar.
2. **IA**: crie a chave em [console.anthropic.com](https://console.anthropic.com) e adicione `ANTHROPIC_API_KEY` nas Variables.
3. **Meta (Instagram e WhatsApp)**: siga [`configuracao-meta.md`](configuracao-meta.md). Os webhooks usam:
   - `https://SEU-ENDERECO/webhook/instagram`
   - `https://SEU-ENDERECO/webhook/whatsapp`
4. **Contas de teste**: adicione `INSTAGRAM_TESTE` (seu perfil pessoal) e `WHATSAPP_TESTE` (um WhatsApp pessoal diferente do escritório).
5. **Cópia de segurança**: o plano Hobby pode não incluir backup automático do volume. Vamos configurar uma cópia periódica do banco antes de receber leads reais.
