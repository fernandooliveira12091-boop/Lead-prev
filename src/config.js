import 'dotenv/config';

const env = process.env;

// Valores copiados do exemplo do guia (ex.: "<crie uma senha longa>") não podem ser usados.
const preenchido = (v) => (v && !/[<>]/.test(v) ? v : '');
// Remove espaços e aspas colados sem querer junto com o valor.
const limpo = (v) => (v ?? '').trim().replace(/^(["'])(.*)\1$/, '$2');
const senhaPainel = limpo(env.ADMIN_TOKEN);
// Aceita a connection string mesmo colada no formato psql ("psql 'postgresql://...'") ou entre aspas.
const urlBanco = /postgres(?:ql)?:\/\/[^\s'"]+/.exec(env.DATABASE_URL ?? '')?.[0] ?? '';

export const config = {
  port: Number(env.PORT ?? 3000),
  adminToken: preenchido(senhaPainel).length >= 12 ? senhaPainel : '',
  painelUsuario: limpo(env.PAINEL_USUARIO) || 'admin',

  escritorio: {
    nome: env.ESCRITORIO_NOME ?? 'Escritório de Advocacia Previdenciária',
    advogado: env.ADVOGADO_NOME ?? '',
    oab: env.OAB ?? '',
    whatsappAdvogado: env.ADVOGADO_WHATSAPP ?? '',
  },

  // Com o número em coexistência (app + API), clientes atuais também escrevem para ele.
  // A IA só atende quem chegou por um post/anúncio rastreado; o resto fica para o escritório no app.
  iaSomenteOrigemRastreada: env.IA_SOMENTE_ORIGEM_RASTREADA !== '0',

  claude: {
    model: env.CLAUDE_MODEL ?? 'claude-opus-5-5',
  },

  meta: {
    accessToken: env.META_ACCESS_TOKEN ?? '',
    appSecret: env.META_APP_SECRET ?? '',
    verifyToken: preenchido(env.META_VERIFY_TOKEN),
    graphVersion: env.META_GRAPH_VERSION ?? 'v23.0',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    whatsappNumero: env.WHATSAPP_NUMERO ?? '',
  },

  // WhatsApp pela Meta direto ("meta") ou por parceiro oficial com coexistência ("360dialog" ou "ycloud").
  whatsapp: {
    provedor: ['360dialog', 'ycloud'].find((p) => p === limpo(env.WHATSAPP_PROVEDOR)?.toLowerCase()) ?? 'meta',
    ycloudKey: limpo(env.YCLOUD_API_KEY),
    ycloudBase: (env.YCLOUD_API_URL ?? 'https://api.ycloud.com/v2').replace(/\/$/, ''),
    d360Key: limpo(env.D360_API_KEY),
    d360Base: (env.D360_API_URL ?? 'https://waba-v2.360dialog.io').replace(/\/$/, ''),
    // Os parceiros não assinam os webhooks como a Meta; a autenticidade vem desta chave secreta na URL.
    webhookChave: limpo(env.WHATSAPP_WEBHOOK_CHAVE).length >= 16 ? limpo(env.WHATSAPP_WEBHOOK_CHAVE) : '',
  },

  instagram: {
    accountId: env.INSTAGRAM_ACCOUNT_ID ?? '',
    accessToken: limpo(env.INSTAGRAM_ACCESS_TOKEN),
    appSecret: env.INSTAGRAM_APP_SECRET || env.META_APP_SECRET || '',
    graphHost: env.INSTAGRAM_GRAPH_HOST ?? 'graph.instagram.com',
  },

  followup: {
    template: env.FOLLOWUP_TEMPLATE ?? 'retomar_atendimento',
    idioma: env.FOLLOWUP_TEMPLATE_IDIOMA ?? 'pt_BR',
    aposHoras: Number(env.FOLLOWUP_APOS_HORAS ?? 24),
    maxTentativas: Number(env.FOLLOWUP_MAX_TENTATIVAS ?? 2),
  },

  // Postgres (ex.: Neon). Vazio = banco embutido em memória, só para testes e simulação.
  databaseUrl: preenchido(urlBanco),
  campanhasPath: env.CAMPANHAS_PATH ?? 'data/campanhas.json',
};
