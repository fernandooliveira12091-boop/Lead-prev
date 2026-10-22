import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.DB_PATH = ':memory:';
const { campanhaPorRef, comentarioDisparaResposta, extrairRef, linkWhatsapp } = await import('../src/campanhas.js');
const { assinaturaValida } = await import('../src/meta.js');
const { jaProcessado, obterOuCriarLead, registrarMensagem, leadsParaFollowup, atualizarLead, db } = await import('../src/db.js');

test('extrai a ref do post a partir do texto do wa.me', () => {
  assert.equal(extrairRef('Olá! Vi o post sobre BPC (ref:BPC01)'), 'BPC01');
  assert.equal(extrairRef('oi'), undefined);
});

test('link do WhatsApp carrega a ref', () => {
  const c = campanhaPorRef('ar002');
  assert.ok(c);
  assert.equal(extrairRef(decodeURIComponent(linkWhatsapp(c).split('text=')[1])), 'AR002');
});

test('palavra-chave no comentário ignora acentos e maiúsculas', () => {
  const c = { palavrasChave: ['revisao'] };
  assert.ok(comentarioDisparaResposta(c, 'Quero a REVISÃO!'));
  assert.ok(!comentarioDisparaResposta(c, 'que post legal'));
});

test('valida assinatura do webhook da Meta', () => {
  const body = Buffer.from('{"a":1}');
  const sig = 'sha256=' + createHmac('sha256', 'segredo').update(body).digest('hex');
  assert.ok(assinaturaValida(body, sig, 'segredo'));
  assert.ok(!assinaturaValida(body, sig, 'outro'));
  assert.ok(!assinaturaValida(body, undefined, 'segredo'));
});

test('eventos repetidos da Meta são ignorados', () => {
  assert.equal(jaProcessado('wa:1'), false);
  assert.equal(jaProcessado('wa:1'), true);
});

test('follow-up só para quem consentiu e ficou em silêncio', () => {
  const a = obterOuCriarLead({ canal: 'whatsapp', contato: '551100000001' });
  const b = obterOuCriarLead({ canal: 'whatsapp', contato: '551100000002' });
  for (const l of [a, b]) {
    registrarMensagem(l.id, 'lead', 'oi');
    registrarMensagem(l.id, 'ia', 'olá');
  }
  db.prepare("UPDATE leads SET ultima_msg_lead = datetime('now','-30 hours'), ultima_msg_escritorio = datetime('now','-29 hours')").run();
  atualizarLead(a.id, { consentimento_lgpd: 1 });
  const ids = leadsParaFollowup(24, 2).map((l) => l.id);
  assert.deepEqual(ids, [a.id]);
});
