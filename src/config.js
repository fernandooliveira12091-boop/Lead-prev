import 'dotenv/config';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  adminToken: env.ADMIN_TOKEN ?? '',

  escritorio: {
    nome: env.ESCRITORIO_NOME ?? 'Escritório de Advocacia Previdenciária',
    advogado: env.ADVOGADO_NOME ?? '',
    oab: env.OAB ?? '',
    whatsappAdvogado: env.ADVOGADO_WHATSAPP ?? '',
  },

  claude: {
    model: env.CLAUDE_MODEL ?? 'claude-opus-5-5',
  },

  meta: {
    accessToken: env.META_ACCESS_TOKEN ?? '',
    appSecret: env.META_APP_SECRET ?? '',
    verifyToken: env.META_VERIFY_TOKEN ?? '',
    graphVersion: env.META_GRAPH_VERSION ?? 'v23.0',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    whatsappNumero: env.WHATSAPP_NUMERO ?? '',
  },

  instagram: {
    accountId: env.INSTAGRAM_ACCOUNT_ID ?? '',
    accessToken: env.INSTAGRAM_ACCESS_TOKEN ?? '',
    appSecret: env.INSTAGRAM_APP_SECRET || env.META_APP_SECRET || '',
    graphHost: env.INSTAGRAM_GRAPH_HOST ?? 'graph.instagram.com',
  },

  followup: {
    template: env.FOLLOWUP_TEMPLATE ?? 'retomar_atendimento',
    idioma: env.FOLLOWUP_TEMPLATE_IDIOMA ?? 'pt_BR',
    aposHoras: Number(env.FOLLOWUP_APOS_HORAS ?? 24),
    maxTentativas: Number(env.FOLLOWUP_MAX_TENTATIVAS ?? 2),
  },

  dbPath: env.DB_PATH ?? 'data/leads.db',
  campanhasPath: env.CAMPANHAS_PATH ?? 'data/campanhas.json',
};
