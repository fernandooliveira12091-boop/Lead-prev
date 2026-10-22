import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

// DRY_RUN=1: nada é enviado à Meta, as chamadas só aparecem no log (usado por `npm run simular` e pelos testes).
const dryRun = () => process.env.DRY_RUN === '1';

export class EnvioBloqueado extends Error {}

// Modo homologação (padrão): só envia para os contatos de teste listados no .env.
// Para atender o público, é preciso desligar explicitamente: MODO_HOMOLOGACAO=0.
// Celulares brasileiros antigos aparecem no WhatsApp sem o nono dígito (55 61 9165-8755 = 55 61 99165-8755).
// Para comparar números, usa-se a forma sem o 9.
export function numeroCanonico(n) {
  const d = String(n ?? '').replace(/\D/g, '');
  return /^55\d{2}9\d{8}$/.test(d) ? d.slice(0, 4) + d.slice(5) : d;
}

export function podeEnviar(canal, destinos) {
  if (process.env.MODO_HOMOLOGACAO === '0') return true;
  const norm = (s) => (canal === 'whatsapp' ? numeroCanonico(s) : String(s).replace(/^@/, '').toLowerCase());
  // O aviso interno ao advogado não é mensagem a lead.
  if (canal === 'whatsapp' && config.escritorio.whatsappAdvogado && destinos.some((d) => norm(d) === norm(config.escritorio.whatsappAdvogado))) return true;
  const lista = (canal === 'whatsapp' ? process.env.WHATSAPP_TESTE : process.env.INSTAGRAM_TESTE) ?? '';
  const permitidos = new Set(lista.split(',').map((s) => s.trim()).filter(Boolean).map(norm));
  return destinos.filter(Boolean).some((d) => permitidos.has(norm(d)));
}

export function mascarar(s) {
  const t = String(s ?? '');
  return t.length <= 4 ? '***' : `${t.slice(0, 2)}***${t.slice(-2)}`;
}

function garantirPermissao(canal, destinos) {
  if (!podeEnviar(canal, destinos)) {
    throw new EnvioBloqueado(`envio bloqueado pelo modo homologação (${canal} ${mascarar(destinos[0])})`);
  }
}

async function requisitar(url, headers, body) {
  if (dryRun()) {
    console.log('[simulação] POST', url.replace(/\/\d{6,}\//, '/<id>/'), JSON.stringify(body).slice(0, 300));
    return {};
  }
  const r = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detalhe = json?.error?.message ?? json?.meta?.developer_message ?? json?.errors?.[0]?.details ?? 'erro desconhecido';
    throw new Error(`Meta API ${r.status}: ${detalhe}`);
  }
  return json;
}

async function post(url, token, body) {
  if (!token && !dryRun()) throw new Error('Token da Meta não configurado');
  return requisitar(url, { Authorization: `Bearer ${token}` }, body);
}

export async function get(url, token) {
  if (!token) throw new Error('Token do Instagram não configurado (INSTAGRAM_ACCESS_TOKEN)');
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Meta API ${r.status}: ${json?.error?.message ?? 'erro desconhecido'}`);
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

// Mesmo formato de mensagem nos dois provedores; muda só o endereço e a autenticação.
function waPost(body) {
  if (config.whatsapp.provedor === 'ycloud') return ycloudPost(body);
  if (config.whatsapp.provedor === '360dialog') {
    if (!config.whatsapp.d360Key && !dryRun()) throw new Error('Chave da 360dialog não configurada (D360_API_KEY)');
    return requisitar(`${config.whatsapp.d360Base}/messages`, { 'D360-API-KEY': config.whatsapp.d360Key }, body);
  }
  return post(waUrl(), config.meta.accessToken, body);
}

// YCloud: mesmo conteúdo de mensagem, mas com remetente explícito e números no formato +55...
function ycloudPost(body) {
  if (body.status === 'read') return Promise.resolve({}); // confirmação de leitura não é necessária
  if (!config.whatsapp.ycloudKey && !dryRun()) throw new Error('Chave da YCloud não configurada (YCLOUD_API_KEY)');
  const mais = (n) => `+${String(n).replace(/\D/g, '')}`;
  const { messaging_product: _, ...resto } = body;
  return requisitar(`${config.whatsapp.ycloudBase}/whatsapp/messages/sendDirectly`, { 'X-API-Key': config.whatsapp.ycloudKey }, {
    ...resto,
    from: mais(config.meta.whatsappNumero),
    to: mais(body.to),
  });
}

export async function testarYcloud() {
  const r = await fetch(`${config.whatsapp.ycloudBase}/whatsapp/phoneNumbers`, { headers: { 'X-API-Key': config.whatsapp.ycloudKey } });
  if (r.status === 401 || r.status === 403) throw new Error('chave da YCloud inválida');
  if (!r.ok) throw new Error(`YCloud ${r.status}`);
  const json = await r.json().catch(() => ({}));
  const numeros = (json.items ?? []).map((n) => n.phoneNumber ?? n.displayPhoneNumber).filter(Boolean);
  if (!numeros.length) return 'chave da YCloud válida';
  const digitos = (n) => String(n).replace(/\D/g, '');
  const meu = digitos(config.meta.whatsappNumero);
  if (!numeros.some((n) => digitos(n) === meu)) {
    throw new Error(`WHATSAPP_NUMERO (${meu || 'vazio'}) diferente do número conectado na YCloud (${numeros.map(digitos).join(', ')}); corrija no Render`);
  }
  return `conectado pela YCloud (${numeros.join(', ')})`;
}

/** Cadastra na 360dialog o endereço que recebe as mensagens (webhook). */
export function registrarWebhook360(url) {
  if (!config.whatsapp.d360Key) throw new Error('Chave da 360dialog não configurada (D360_API_KEY)');
  return requisitar(`${config.whatsapp.d360Base}/v1/configs/webhook`, { 'D360-API-KEY': config.whatsapp.d360Key }, { url });
}

export async function consultarWebhook360() {
  const r = await fetch(`${config.whatsapp.d360Base}/v1/configs/webhook`, { headers: { 'D360-API-KEY': config.whatsapp.d360Key } });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`360dialog ${r.status}: ${r.status === 401 ? 'chave da 360dialog inválida' : JSON.stringify(json).slice(0, 150)}`);
  return json;
}

export function whatsappTexto(para, texto) {
  garantirPermissao('whatsapp', [para]);
  return waPost({
    messaging_product: 'whatsapp',
    to: para,
    type: 'text',
    text: { body: texto, preview_url: false },
  });
}

// Fora da janela de 24h após a última mensagem do lead, o WhatsApp só permite templates aprovados.
export function whatsappTemplate(para, nome, idioma, parametros = []) {
  garantirPermissao('whatsapp', [para]);
  return waPost({
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
  return waPost({
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  });
}

// ---------- Instagram ----------

const igBase = () => `https://${config.instagram.graphHost}/${config.meta.graphVersion}`;

export function instagramDM(igsid, texto) {
  garantirPermissao('instagram', [igsid]);
  return post(`${igBase()}/${config.instagram.accountId}/messages`, config.instagram.accessToken, {
    recipient: { id: igsid },
    message: { text: texto },
  });
}

// "Resposta privada": uma única DM para quem comentou, em até 7 dias após o comentário.
export function instagramRespostaPrivada(commentId, texto, autor) {
  garantirPermissao('instagram', [autor?.id, autor?.usuario]);
  return post(`${igBase()}/${config.instagram.accountId}/messages`, config.instagram.accessToken, {
    recipient: { comment_id: commentId },
    message: { text: texto },
  });
}

export function instagramResponderComentario(commentId, texto, autor) {
  garantirPermissao('instagram', [autor?.id, autor?.usuario]);
  return post(`${igBase()}/${commentId}/replies`, config.instagram.accessToken, { message: texto });
}

const CAMPOS_MIDIA = 'id,caption,permalink,timestamp,media_type,media_product_type,comments_count';

export function instagramMidia(mediaId) {
  return get(`${igBase()}/${encodeURIComponent(mediaId)}?fields=${CAMPOS_MIDIA}`, config.instagram.accessToken);
}

/** Procura, entre as publicações da conta, a que tem o shortcode do link (instagram.com/p/<shortcode>/). */
export async function instagramMidiaPorShortcode(shortcode, maxPaginas = 10) {
  let url = `${igBase()}/${config.instagram.accountId}/media?fields=${CAMPOS_MIDIA}&limit=50`;
  for (let i = 0; url && i < maxPaginas; i++) {
    const pagina = await get(url, config.instagram.accessToken);
    const achada = pagina.data?.find((m) => shortcodeDoLink(m.permalink) === shortcode);
    if (achada) return achada;
    url = pagina.paging?.next;
  }
  return undefined;
}

export function shortcodeDoLink(link) {
  return /instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/.exec(link ?? '')?.[1];
}

/** Todos os comentários de primeiro nível de uma mídia (respostas dentro de comentários são ignoradas). */
export async function instagramComentarios(mediaId, maxPaginas = 20) {
  const todos = [];
  let url = `${igBase()}/${encodeURIComponent(mediaId)}/comments?fields=id,text,timestamp,username,from&limit=50`;
  for (let i = 0; url && i < maxPaginas; i++) {
    const pagina = await get(url, config.instagram.accessToken);
    for (const c of pagina.data ?? []) {
      todos.push({ id: c.id, texto: c.text ?? '', criadoEm: c.timestamp, usuario: c.username ?? c.from?.username, autorId: c.from?.id });
    }
    url = pagina.paging?.next;
  }
  return todos;
}
