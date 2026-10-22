import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { consultar } from './db.js';
import { consultarWebhook360, get } from './meta.js';

// Verificações da tela "Conexões": o que já está configurado e se cada serviço responde.
// Nenhuma verificação mostra tokens ou senhas.

export function configuracao() {
  const env = process.env;
  return [
    { nome: 'Banco de dados (Neon)', ok: !!config.databaseUrl, falta: 'DATABASE_URL' },
    { nome: 'IA (Claude)', ok: !!env.ANTHROPIC_API_KEY, falta: 'ANTHROPIC_API_KEY' },
    { nome: 'Instagram', ok: !!(config.instagram.accountId && config.instagram.accessToken), falta: 'INSTAGRAM_ACCOUNT_ID e INSTAGRAM_ACCESS_TOKEN' },
    config.whatsapp.provedor === '360dialog'
      ? { nome: 'WhatsApp', ok: !!(config.whatsapp.d360Key && config.whatsapp.webhookChave), falta: 'D360_API_KEY e WHATSAPP_WEBHOOK_CHAVE (16+ caracteres)' }
      : { nome: 'WhatsApp', ok: !!(config.meta.phoneNumberId && config.meta.accessToken), falta: 'WHATSAPP_PHONE_NUMBER_ID e META_ACCESS_TOKEN' },
    { nome: 'Assinatura dos webhooks', ok: !!config.meta.appSecret, falta: 'META_APP_SECRET' },
    { nome: 'Token de verificação dos webhooks', ok: !!config.meta.verifyToken, falta: 'META_VERIFY_TOKEN' },
  ];
}

const testes = {
  async 'Banco de dados (Neon)'() {
    await consultar('SELECT 1');
    return 'conectado';
  },
  async 'IA (Claude)'() {
    const r = await new Anthropic().messages.create({
      model: config.claude.model,
      max_tokens: 2048,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'Responda apenas com a palavra: ok' }],
    });
    return `respondeu (modelo ${r.model})`;
  },
  async Instagram() {
    const base = `https://${config.instagram.graphHost}/${config.meta.graphVersion}`;
    const me = await get(`${base}/me?fields=id,username`, config.instagram.accessToken);
    return `conta @${me.username} (id ${me.id})`;
  },
  async WhatsApp() {
    if (config.whatsapp.provedor === '360dialog') {
      const w = await consultarWebhook360();
      return w?.url?.includes('/webhook/whatsapp')
        ? 'conectado pela 360dialog; webhook cadastrado'
        : 'conectado pela 360dialog, mas o webhook ainda não foi cadastrado (use o botão abaixo)';
    }
    const n = await get(
      `https://graph.facebook.com/${config.meta.graphVersion}/${config.meta.phoneNumberId}?fields=display_phone_number,verified_name`,
      config.meta.accessToken,
    );
    return `número ${n.display_phone_number} (${n.verified_name ?? 'nome não verificado'})`;
  },
};

function explicar(nome, e) {
  const status = e.status ?? /Meta API (\d+)/.exec(e.message ?? '')?.[1];
  if (nome === 'IA (Claude)') {
    if (status == 401) return 'chave da API inválida: gere outra em console.anthropic.com e cole em ANTHROPIC_API_KEY';
    if (status == 400 && /credit|billing|balance/i.test(e.message)) return 'sem créditos: adicione saldo em console.anthropic.com > Billing';
    if (status == 429) return 'limite de uso atingido; tente de novo em instantes';
  }
  if (status == 190 || /access token|OAuthException/i.test(e.message ?? '')) return 'token inválido ou expirado: gere um novo na Meta';
  return (e.message ?? String(e)).replace(/(sk-ant-|EAA|IG)[A-Za-z0-9_-]{8,}/g, '[oculto]').slice(0, 200);
}

export async function testarConexoes() {
  const resultados = [];
  for (const item of configuracao()) {
    const teste = testes[item.nome];
    if (!teste) continue;
    if (!item.ok) {
      resultados.push({ nome: item.nome, ok: false, detalhe: `não configurado (falta ${item.falta})` });
      continue;
    }
    try {
      resultados.push({ nome: item.nome, ok: true, detalhe: await teste() });
    } catch (e) {
      resultados.push({ nome: item.nome, ok: false, detalhe: explicar(item.nome, e) });
    }
  }
  return resultados;
}
