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
