import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

const { campanhaPorRef, comentarioDisparaResposta, extrairRef, linkWhatsapp } = await import('../src/campanhas.js');
const { assinaturaValida } = await import('../src/meta.js');
const { jaProcessado, obterOuCriarLead, registrarMensagem, leadsParaFollowup, atualizarLead, consultar } = await import('../src/db.js');

test('extrai a ref do post a partir do texto do wa.me', async () => {
  assert.equal(extrairRef('Olá! Vi o post sobre BPC (ref:BPC01)'), 'BPC01');
  assert.equal(extrairRef('oi'), undefined);
});

test('link do WhatsApp carrega a ref', async () => {
  const c = await campanhaPorRef('ar002');
  assert.ok(c);
  assert.equal(extrairRef(decodeURIComponent(linkWhatsapp(c).split('text=')[1])), 'AR002');
});

test('palavra-chave no comentário ignora acentos e maiúsculas', async () => {
  const c = { palavrasChave: ['revisao'] };
  assert.ok(comentarioDisparaResposta(c, 'Quero a REVISÃO!'));
  assert.ok(!comentarioDisparaResposta(c, 'que post legal'));
});

test('valida assinatura do webhook da Meta', async () => {
  const body = Buffer.from('{"a":1}');
  const sig = 'sha256=' + createHmac('sha256', 'segredo').update(body).digest('hex');
  assert.ok(assinaturaValida(body, sig, 'segredo'));
  assert.ok(!assinaturaValida(body, sig, 'outro'));
  assert.ok(!assinaturaValida(body, undefined, 'segredo'));
});

test('eventos repetidos da Meta são ignorados', async () => {
  assert.equal((await jaProcessado('wa:1')), false);
  assert.equal((await jaProcessado('wa:1')), true);
});

test('follow-up só para quem consentiu e ficou em silêncio', async () => {
  const a = await obterOuCriarLead({ canal: 'whatsapp', contato: '551100000001' });
  const b = await obterOuCriarLead({ canal: 'whatsapp', contato: '551100000002' });
  for (const l of [a, b]) {
    await registrarMensagem(l.id, 'lead', 'oi');
    await registrarMensagem(l.id, 'ia', 'olá');
  }
  await consultar("UPDATE leads SET ultima_msg_lead = now() - interval '30 hours', ultima_msg_escritorio = now() - interval '29 hours'");
  await atualizarLead(a.id, { consentimento_lgpd: 1 });
  const ids = (await leadsParaFollowup(24, 2)).map((l) => l.id);
  assert.deepEqual(ids, [a.id]);
});

test('senha e banco com texto de exemplo do guia são recusados', async () => {
  const { execFileSync } = await import('node:child_process');
  const ler = (env) => execFileSync(process.execPath, ['-e', "import('./src/config.js').then(m => console.log(JSON.stringify([m.config.adminToken, m.config.databaseUrl])))"], { env: { ...process.env, ...env } }).toString().trim();
  assert.equal(ler({ ADMIN_TOKEN: '<crie uma senha longa>', DATABASE_URL: '<cole a connection string da Neon>' }), '["",""]');
  assert.equal(ler({ ADMIN_TOKEN: 'curta', DATABASE_URL: '' }), '["",""]');
  assert.equal(ler({ ADMIN_TOKEN: 'Cafe-Rio-Lapis-Azul-2026', DATABASE_URL: 'postgresql://u:p@h/db' }), '["Cafe-Rio-Lapis-Azul-2026","postgresql://u:p@h/db"]');
});

test('número com e sem o nono dígito é reconhecido como o mesmo na lista de teste', async () => {
  const { numeroCanonico, podeEnviar } = await import('../src/meta.js');
  assert.equal(numeroCanonico('5561991658755'), numeroCanonico('556191658755'));
  assert.equal(numeroCanonico('+55 (61) 99165-8755'), '556191658755');
  process.env.MODO_HOMOLOGACAO = '1';
  process.env.WHATSAPP_TESTE = '5561988887777';
  assert.ok(podeEnviar('whatsapp', ['556188887777']));
  assert.ok(!podeEnviar('whatsapp', ['556188880000']));
});
