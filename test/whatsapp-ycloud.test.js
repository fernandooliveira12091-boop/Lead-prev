// WhatsApp pela YCloud (plano gratuito, coexistência): envio, eventos no formato da YCloud e chave do webhook.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  WHATSAPP_PROVEDOR: 'ycloud',
  YCLOUD_API_KEY: 'chave-ycloud-teste',
  WHATSAPP_WEBHOOK_CHAVE: 'chave-do-webhook-com-mais-de-16',
  ADMIN_TOKEN: 'senha-teste-longa',
  ANTHROPIC_API_KEY: 'sk-teste',
  WHATSAPP_NUMERO: '556191658755',
  WHATSAPP_TESTE: '5561977776666',
  MODO_HOMOLOGACAO: '1',
  ESPERA_RESPOSTA_MS: '0',
});

const chamadas = [];
const webhooks = [{ id: 'errado', url: 'https://whatsapp.inbound_message.received', enabledEvents: [], status: 'active' }];
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
  if (u.endsWith('/whatsapp/phoneNumbers')) return new Response(JSON.stringify({ items: [{ phoneNumber: '+556191658755' }] }));
  if (u.includes('/webhookEndpoints')) {
    const corpo = init.body ? JSON.parse(init.body) : {};
    if (init.method === 'POST') webhooks.push({ id: `wh${webhooks.length + 1}`, ...corpo });
    if (init.method === 'PATCH') Object.assign(webhooks.find((w) => u.endsWith(`/${w.id}`)), corpo);
    return new Response(JSON.stringify(init.method === 'GET' || !init.method ? { items: webhooks } : { ok: true }));
  }
  return new Response(JSON.stringify({ id: 'ok' }), { headers: { 'content-type': 'application/json' } });
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
async function esperarAte(cond) {
  for (let i = 0; i < 50 && !(await cond()); i++) await esperar(100);
}
const CHAVE = 'chave-do-webhook-com-mais-de-16';
const evento = (corpo) => fetch(`${base}/webhook/whatsapp?chave=${CHAVE}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
const entrada = (de, texto, id) => ({
  id: `ev-${id}`, type: 'whatsapp.inbound_message.received',
  whatsappInboundMessage: { id, wamid: `wamid.${id}`, from: `+${de}`, to: '+556191658755', customerProfile: { name: 'Teste' }, type: 'text', text: { body: texto } },
});

test('evento da YCloud sem a chave é recusado', async () => {
  const r = await fetch(`${base}/webhook/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(entrada('5561977776666', 'oi', 'a0')) });
  assert.equal(r.status, 401);
});

test('mensagem de campanha chega no formato da YCloud e a IA responde pela YCloud', async () => {
  assert.equal((await evento(entrada('5561977776666', 'Olá, vi o post (ref:AR001)', 'a1'))).status, 200);
  await esperarAte(() => chamadas.some((c) => c.url.endsWith('/sendDirectly')));
  const envio = chamadas.find((c) => c.url === 'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly');
  assert.ok(envio, 'resposta enviada pela YCloud');
  assert.equal(envio.headers['X-API-Key'], 'chave-ycloud-teste');
  assert.equal(envio.body.from, '+556191658755');
  assert.equal(envio.body.to, '+5561977776666');
  assert.equal(envio.body.type, 'text');
  assert.equal(envio.body.messaging_product, undefined);
  const lead = (await listarLeads()).find((l) => l.contato === '5561977776666');
  assert.equal(lead.origem_ref, 'AR001');
});

test('resposta enviada pelo app (eco da coexistência) tira a IA da conversa', async () => {
  await evento({ id: 'ev-e1', type: 'whatsapp.smb.message.echoes', whatsappMessage: { id: 'e1', wamid: 'wamid.e1', from: '+556191658755', to: '+5561977776666', type: 'text', text: { body: 'Oi, aqui é o Fernando.' } } });
  await esperarAte(async () => (await listarLeads()).find((l) => l.contato === '5561977776666')?.ia_ativa === 0);
  const lead = (await listarLeads()).find((l) => l.contato === '5561977776666');
  assert.equal(lead.ia_ativa, 0);
  assert.equal((await historico(lead.id)).at(-1).autor, 'humano');
});

test('tela Conexões testa a chave da YCloud e mostra o endereço do webhook', async () => {
  const AUTH = { authorization: 'Basic ' + Buffer.from('admin:senha-teste-longa').toString('base64') };
  const pagina = await (await fetch(`${base}/painel/status`, { headers: AUTH })).text();
  assert.match(pagina, /webhook\/whatsapp\?chave=chave-do-webhook-com-mais-de-16/);
  const teste = await (await fetch(`${base}/painel/status/testar`, { method: 'POST', headers: AUTH })).text();
  assert.match(teste, /conectado pela YCloud/);
});

test('botão da tela Conexões cadastra e depois corrige o webhook na YCloud', async () => {
  const AUTH = { authorization: 'Basic ' + Buffer.from('admin:senha-teste-longa').toString('base64') };
  const testar = async () => (await fetch(`${base}/painel/status/testar`, { method: 'POST', headers: AUTH })).text();
  assert.match(await testar(), /webhook ainda não cadastrado na YCloud/);

  assert.match(await (await fetch(`${base}/painel/status/webhookycloud`, { method: 'POST', headers: AUTH })).text(), /webhook cadastrado e ativo/);
  const nossos = webhooks.filter((w) => w.id !== 'errado');
  assert.equal(nossos.length, 1);
  assert.equal(new URL(nossos[0].url).searchParams.get('chave'), CHAVE);
  assert.deepEqual(nossos[0].enabledEvents, ['whatsapp.inbound_message.received', 'whatsapp.smb.message.echoes']);

  // Alguém desativa e troca o endereço à mão: o botão corrige o mesmo cadastro, sem duplicar.
  Object.assign(nossos[0], { status: 'disabled', url: nossos[0].url.replace(CHAVE, 'outra-chave-qualquer-123') });
  assert.match(await testar(), /endereço ou chave diferente/);
  await fetch(`${base}/painel/status/webhookycloud`, { method: 'POST', headers: AUTH });
  assert.equal(webhooks.filter((w) => w.id !== 'errado').length, 1);
  assert.match(await testar(), /webhook cadastrado e ativo/);
});
