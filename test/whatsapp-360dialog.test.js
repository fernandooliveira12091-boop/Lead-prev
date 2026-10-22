// WhatsApp pela 360dialog (coexistência): envio, webhook protegido por chave e cadastro do webhook.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  WHATSAPP_PROVEDOR: '360dialog',
  D360_API_KEY: 'chave-360-teste',
  WHATSAPP_WEBHOOK_CHAVE: 'chave-do-webhook-com-mais-de-16',
  ADMIN_TOKEN: 'senha-teste-longa',
  ANTHROPIC_API_KEY: 'sk-teste',
  WHATSAPP_NUMERO: '5561991658755',
  WHATSAPP_TESTE: '5561977776666',
  MODO_HOMOLOGACAO: '1',
  ESPERA_RESPOSTA_MS: '0',
});

const chamadas = [];
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return fetchReal(url, init);
  chamadas.push({ url: u, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined });
  if (u.includes('api.anthropic.com')) {
    const saida = {
      resposta: 'Olá! Sou o assistente virtual do escritório. Posso usar suas informações para analisar o caso?',
      area: 'aposentadoria_rural', nome: null, fatos_relevantes: [], consentimento_lgpd: false, optout: false,
      status: 'em_triagem', encaminhar_advogado: false, resumo_para_advogado: '',
    };
    return new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: JSON.stringify(saida) }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), { headers: { 'content-type': 'application/json' } });
  }
  if (u.includes('/v1/configs/webhook') && init.method !== 'POST') return new Response(JSON.stringify({ url: 'https://lead-prev.onrender.com/webhook/whatsapp?chave=x' }));
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
};

const { app } = await import('../src/server.js');
const { listarLeads, historico } = await import('../src/db.js');
let base, servidor;
before(async () => {
  servidor = app.listen(0, '127.0.0.1');
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
// O banco embutido demora um pouco na primeira consulta; espera a condição por até 5 s.
async function esperarAte(cond) {
  for (let i = 0; i < 50 && !(await cond()); i++) await esperar(100);
}
const payload = (de, texto, id) => ({ entry: [{ changes: [{ field: 'messages', value: { contacts: [{ wa_id: de, profile: { name: 'Teste' } }], messages: [{ from: de, id, type: 'text', text: { body: texto } }] } }] }] });
const enviarWebhook = (chave, corpo) =>
  fetch(`${base}/webhook/whatsapp${chave ? `?chave=${chave}` : ''}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

test('webhook sem a chave secreta é recusado', async () => {
  assert.equal((await enviarWebhook('', payload('5561977776666', 'oi (ref:AR001)', 'w1'))).status, 401);
  assert.equal((await enviarWebhook('errada', payload('5561977776666', 'oi (ref:AR001)', 'w1'))).status, 401);
});

test('mensagem de campanha pela 360dialog: IA responde pelo endpoint da 360dialog', async () => {
  const r = await enviarWebhook('chave-do-webhook-com-mais-de-16', payload('5561977776666', 'Olá, vi o post (ref:AR001)', 'w2'));
  assert.equal(r.status, 200);
  await esperarAte(() => chamadas.some((c) => c.url.endsWith('/messages') && c.body?.type === 'text'));
  const envio = chamadas.find((c) => c.url === 'https://waba-v2.360dialog.io/messages' && c.body?.type === 'text');
  assert.ok(envio, 'resposta enviada pela 360dialog');
  assert.equal(envio.headers['D360-API-KEY'], 'chave-360-teste');
  assert.equal(envio.body.to, '5561977776666');
  assert.ok(!chamadas.some((c) => c.url.includes('graph.facebook.com')), 'nada vai para a Graph API da Meta');
  const lead = (await listarLeads()).find((l) => l.contato === '5561977776666');
  assert.equal(lead.origem_ref, 'AR001');
  assert.equal((await historico(lead.id)).at(-1).autor, 'ia');
});

test('cliente atual escrevendo no número compartilhado é ignorado', async () => {
  const antes = chamadas.length;
  await enviarWebhook('chave-do-webhook-com-mais-de-16', payload('5561955554444', 'Doutor, novidades do meu processo?', 'w3'));
  await esperar(100);
  assert.equal(chamadas.length, antes);
});

test('painel cadastra o webhook na 360dialog com a chave na URL', async () => {
  const AUTH = { authorization: 'Basic ' + Buffer.from('admin:senha-teste-longa').toString('base64') };
  const r = await fetch(`${base}/painel/status/webhook360`, { method: 'POST', headers: AUTH });
  assert.match(await r.text(), /cadastrado/);
  const cad = chamadas.find((c) => c.url.endsWith('/v1/configs/webhook') && c.body);
  assert.match(cad.body.url, /\/webhook\/whatsapp\?chave=chave-do-webhook-com-mais-de-16$/);
});
