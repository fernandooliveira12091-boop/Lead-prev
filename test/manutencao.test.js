import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.INSTAGRAM_ACCESS_TOKEN = 'token-do-render';
const { consultar, obterOuCriarLead, registrarMensagem } = await import('../src/db.js');
const { config } = await import('../src/config.js');
const { aplicarRetencao, carregarTokenInstagram, renovarTokenInstagram } = await import('../src/manutencao.js');

const chamadas = [];
globalThis.fetch = async (url) => {
  chamadas.push(String(url));
  const atual = new URL(url).searchParams.get('access_token');
  return new Response(JSON.stringify({ access_token: `${atual}+renovado`, expires_in: 5184000 }), { status: 200 });
};

test('renova o token do Instagram, guarda no banco e não renova de novo antes de 7 dias', async () => {
  assert.match(await renovarTokenInstagram(), /renovado \(válido por ~60 dias\)/);
  assert.equal(config.instagram.accessToken, 'token-do-render+renovado');
  assert.match(chamadas[0], /refresh_access_token\?grant_type=ig_refresh_token/);
  assert.equal(await renovarTokenInstagram(), 'renovação não necessária ainda');
  assert.equal(chamadas.length, 1);
});

test('após reiniciar, usa o token renovado salvo; se o token do Render mudar, volta a usar o novo', async () => {
  config.instagram.accessToken = 'token-do-render';
  await carregarTokenInstagram();
  assert.equal(config.instagram.accessToken, 'token-do-render+renovado');
  process.env.INSTAGRAM_ACCESS_TOKEN = 'token-novo-colado';
  config.instagram.accessToken = 'token-novo-colado';
  await carregarTokenInstagram();
  assert.equal(config.instagram.accessToken, 'token-novo-colado');
  await renovarTokenInstagram();
  assert.equal(config.instagram.accessToken, 'token-novo-colado+renovado');
});

test('retenção exclui só leads sem contato há mais de 12 meses', async () => {
  const velho = await obterOuCriarLead({ canal: 'whatsapp', contato: '5500000000001', origemRef: 'AR001' });
  const novo = await obterOuCriarLead({ canal: 'whatsapp', contato: '5500000000002', origemRef: 'AR001' });
  await registrarMensagem(velho.id, 'lead', 'oi');
  await registrarMensagem(novo.id, 'lead', 'oi');
  await consultar("UPDATE leads SET criado_em = now() - interval '14 months', ultima_msg_lead = now() - interval '13 months' WHERE id = $1", [velho.id]);
  const r = await aplicarRetencao(12);
  assert.deepEqual([r.leads, r.mensagens], [1, 1]);
  const restantes = (await consultar('SELECT contato FROM leads')).map((l) => l.contato);
  assert.deepEqual(restantes, ['5500000000002']);
});
