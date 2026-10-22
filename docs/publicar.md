# Publicar o painel de graça (Render + Neon), passo a passo

Ao final você terá o painel em um endereço como `https://lead-prev.onrender.com/painel`, protegido por login e em **modo homologação** (não envia mensagem para ninguém).

- **Render (grátis)**: roda o sistema.
- **Neon (grátis)**: guarda os dados (banco PostgreSQL).

O Render grátis apaga os arquivos a cada reinício; por isso o banco fica separado, na Neon.

Tempo estimado: 25 minutos, num computador.

> **Limites do plano grátis**
> - O Render "dorme" depois de 15 min sem acesso e leva **cerca de 1 min para acordar**. A primeira abertura do painel ou o primeiro lead depois de um tempo parado demora mais.
> - A Neon grátis oferece 1 GB de dados (0,5 GB em páginas mais antigas), que sobra para milhares de leads.
> - Quando funcionar e você quiser tirar o "sono", troque o plano no Render (passo 9). **Não precisa mudar nada no código.**

---

## Parte 1 — Banco de dados na Neon

1. Acesse **[neon.com](https://neon.com)** ➜ **Sign up** ➜ entre com GitHub ou Google.
2. Crie um projeto:
   - **Project name**: `lead-prev`
   - **Postgres version**: a padrão
   - **Region**: **AWS US East (N. Virginia)**, a mesma região que vamos usar no Render, para ficarem perto.
3. Na tela do projeto, clique em **Connect** e copie a **connection string**. Ela começa com `postgresql://` e termina com algo como `?sslmode=require`.
4. Guarde essa string num lugar seguro: ela é a senha do banco. **Não mande pelo chat.**

## Parte 2 — Sistema no Render

5. Acesse **[render.com](https://render.com)** ➜ **Get Started** ➜ entre com a conta do GitHub `fernandooliveira12091-boop`.
6. Clique em **New +** ➜ **Web Service** ➜ conecte o GitHub, se pedir, e escolha o repositório **`lead-prev`**. Se ele não aparecer, use **Configure account** e libere o repositório.
7. Preencha:

   | Campo | Valor |
   |---|---|
   | Name | `lead-prev` (vira parte do endereço) |
   | Branch | `analise-de-posts` |
   | Region | **Virginia (US East)** |
   | Runtime / Language | Node |
   | Build Command | `npm ci` |
   | Start Command | `npm start` |
   | Instance Type | **Free** |

8. Em **Environment Variables** ➜ **Add from .env**, cole o bloco abaixo trocando os três valores entre `< >`:

```
DATABASE_URL=<cole a connection string da Neon>
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

   Depois, se houver a seção **Advanced**, preencha **Health Check Path** com `/saude`. É opcional.

   Clique em **Deploy Web Service** e aguarde alguns minutos, até o log mostrar `lead-prev ouvindo na porta ...`.

> 🔒 Guarde a senha (`ADMIN_TOKEN`) num gerenciador de senhas. **Não envie senhas nem tokens pelo chat**, nem para mim.

## Parte 3 — Conferir

1. No topo da página do serviço aparece o endereço, ex.: `https://lead-prev.onrender.com`.
2. Abra `https://SEU-ENDERECO/saude`. Deve aparecer `{"ok":true}`. Pode levar 1 min se o serviço estava dormindo.
3. Abra `https://SEU-ENDERECO/painel`. O navegador pede usuário e senha:
   - usuário: `fernando`;
   - senha: o seu `ADMIN_TOKEN`.
4. Deve aparecer o painel com a faixa amarela **"Modo homologação ligado"**.
5. Em **Logs**, **não** deve aparecer `ATENÇÃO: DATABASE_URL não definida`. Se aparecer, revise o passo 8: sem o banco, os dados somem a cada reinício.

Enquanto o Instagram não estiver conectado, colar o link de um post mostra *"Token do Instagram não configurado"*. É o esperado.

---

## Se algo der errado

| Sintoma | O que fazer |
|---|---|
| Deploy falhou | Em **Logs**, copie as últimas linhas **sem** senhas e me mande |
| Erro com `password authentication failed` ou `ENOTFOUND` | A `DATABASE_URL` foi colada errada; copie de novo na Neon (botão **Connect**) |
| `/painel` não aceita a senha | Confira `PAINEL_USUARIO` e `ADMIN_TOKEN` (letras maiúsculas, espaço no fim) |
| Página demora muito para abrir | Normal no plano grátis depois de 15 min parado: aguarde até 1 min |

## Passo 9 — Quando funcionar: versão paga (sem mudar código)

- **Tirar o "sono"**: Render ➜ serviço ➜ **Settings** ➜ **Instance Type** ➜ plano pago (Starter).
- **Mais banco ou recursos**: Neon ➜ **Billing** ➜ plano pago, quando o volume crescer.
- Confira os valores atuais em [render.com/pricing](https://render.com/pricing) e [neon.com/pricing](https://neon.com/pricing).

## Próximas etapas (depois que o painel estiver no ar)

1. **IA**: crie a chave em [console.anthropic.com](https://console.anthropic.com) e adicione `ANTHROPIC_API_KEY` nas variáveis do Render. A IA é cobrada por uso.
2. **Meta (Instagram e WhatsApp)**: siga [`configuracao-meta.md`](configuracao-meta.md). Os webhooks usam:
   - `https://SEU-ENDERECO/webhook/instagram`
   - `https://SEU-ENDERECO/webhook/whatsapp`
3. **Contas de teste**: adicione `INSTAGRAM_TESTE` (seu perfil pessoal) e `WHATSAPP_TESTE` (um WhatsApp pessoal diferente do escritório).
4. **Domínio próprio** (opcional): Render ➜ **Settings** ➜ **Custom Domains**, ex.: `leads.seudominio.com.br`.
