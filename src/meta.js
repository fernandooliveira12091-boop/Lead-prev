import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

// Sem credenciais (ou com DRY_RUN=1), nada é enviado à Meta: as chamadas só são registradas no log.
// Útil para testar o fluxo com `npm run simular`.
const dryRun = () => process.env.DRY_RUN === '1';

async function post(url, token, body) {
  if (dryRun() || !token) {
    console.log('[simulação] POST', url, JSON.stringify(body));
    return {};
  }
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Meta API ${r.status}: ${JSON.stringify(json)}`);
  return json;
}

export function assinaturaValida(rawBody, header, secret) {
  if (!secret) return dryRun();
  if (!header?.startsWith('sha256=')) return false;
  const esperado = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(header.slice(7), 'hex');
  const b = Buffer.from(esperado, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- WhatsApp Cloud API ----------

const waUrl = () => `https://graph.facebook.com/${config.meta.graphVersion}/${config.meta.phoneNumberId}/messages`;

export function whatsappTexto(para, texto) {
  return post(waUrl(), config.meta.accessToken, {
    messaging_product: 'whatsapp',
    to: para,
    type: 'text',
    text: { body: texto, preview_url: false },
  });
}

// Fora da janela de 24h após a última mensagem do lead, o WhatsApp só permite templates aprovados.
export function whatsappTemplate(para, nome, idioma, parametros = []) {
  return post(waUrl(), config.meta.accessToken, {
    messaging_product: 'whatsapp',
    to: para,
    type: 'template',
    template: {
      name: nome,
      language: { code: idioma },
      components: parametros.length
        ? [{ type: 'body', parameters: parametros.map((text) => ({ type: 'text', text })) }]
        : [],
    },
  });
}

export function whatsappMarcarLida(messageId) {
  return post(waUrl(), config.meta.accessToken, {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  });
}

// ---------- Instagram ----------

const igBase = () => `https://${config.instagram.graphHost}/${config.meta.graphVersion}`;

export function instagramDM(igsid, texto) {
  return post(`${igBase()}/${config.instagram.accountId}/messages`, config.instagram.accessToken, {
    recipient: { id: igsid },
    message: { text: texto },
  });
}

// "Resposta privada": manda uma DM para quem comentou no post (permitido uma vez por comentário, em até 7 dias).
export function instagramRespostaPrivada(commentId, texto) {
  return post(`${igBase()}/${config.instagram.accountId}/messages`, config.instagram.accessToken, {
    recipient: { comment_id: commentId },
    message: { text: texto },
  });
}

export function instagramResponderComentario(commentId, texto) {
  return post(`${igBase()}/${commentId}/replies`, config.instagram.accessToken, { message: texto });
}
