// Teste ponta a ponta do fluxo "post -> comentários -> aprovação -> WhatsApp", com a Meta e o Claude simulados.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  ADMIN_TOKEN: 'senha-teste-longa',
  ANTHROPIC_API_KEY: 'sk-teste',
  META_ACCESS_TOKEN: 'meta-teste',
  INSTAGRAM_ACCESS_TOKEN: 'ig-teste',
  INSTAGRAM_ACCOUNT_ID: '999',
  WHATSAPP_PHONE_NUMBER_ID: '111',
  WHATSAPP_NUMERO: '5562900000000',
  MODO_HOMOLOGACAO: '1',
  INSTAGRAM_TESTE: 'maria.teste',
  WHATSAPP_TESTE: '5562911111111',
  ADVOGADO_WHATSAPP: '',
  ESPERA_RESPOSTA_MS: '0',
});

const AGORA = new Date().toISOString();
const ANTIGO = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
const enviados = [];
let chamadasClaude = 0;
const fetchReal = globalThis.fetch;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return fetchReal(url, init);
  const metodo = init.method ?? 'GET';

  if (u.includes('/999/media?')) {
    return json({ data: [{ id: '178001', permalink: 'https://www.instagram.com/p/ABC123/', caption: 'Aposentadoria rural negada?\nVeja o que fazer', timestamp: AGORA }] });
  }
  if (u.includes('/178001/comments')) {
    return json({
      data: [
        { id: 'c1', text: 'Trabalhei na roça 30 anos e o INSS negou minha aposentadoria', timestamp: AGORA, username: 'maria.teste', from: { id: 'ig-maria', username: 'maria.teste' } },
        { id: 'c2', text: 'Quero saber mais', timestamp: AGORA, username: 'joao.real', from: { id: 'ig-joao', username: 'joao.real' } },
        { id: 'c3', text: '👏👏', timestamp: AGORA, username: 'ana', from: { id: 'ig-ana', username: 'ana' } },
        { id: 'c4', text: 'Minha mãe é lavradora e foi negado', timestamp: ANTIGO, username: 'maria.teste', from: { id: 'ig-maria', username: 'maria.teste' } },
        { id: 'c5', text: 'Resposta do escritório', timestamp: AGORA, username: 'escritorio', from: { id: '999', username: 'escritorio' } },
      ],
    });
  }
  if (u.includes('api.anthropic.com')) {
    chamadasClaude++;
    const body = JSON.parse(init.body);
    const ultima = body.messages.at(-1).content;
    let saida;
    if (body.system.includes('priorizar os comentários')) {
      const temp = { c1: 'quente', c2: 'morno', c3: 'frio', c4: 'quente' };
      saida = {
        comentarios: JSON.parse(ultima).map((c) => ({
          id: c.id,
          temperatura: temp[c.id] ?? 'frio',
          beneficio: 'aposentadoria_rural',
          motivo: 'teste',
          resposta_publica: 'Obrigado! Te enviamos uma mensagem no direct.',
          mensagem_privada: 'Olá! Aqui é o escritório. Vimos seu comentário; cada caso precisa de análise individual. Quer conversar pelo WhatsApp?',
        })),
      };
    } else {
      saida = {
        resposta: 'Olá! Sou o assistente virtual do escritório. Posso usar suas informações para analisar o caso?',
        area: 'aposentadoria_rural', nome: null, fatos_relevantes: [], consentimento_lgpd: false, optout: false,
        status: 'em_triagem', encaminhar_advogado: false, resumo_para_advogado: '',
      };
    }
    return json({ id: 'msg', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(saida) }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
  }
  if (metodo === 'POST' && (u.includes('graph.instagram.com') || u.includes('graph.facebook.com'))) {
    enviados.push({ url: u, body: JSON.parse(init.body) });
    return json({ ok: true });
  }
  throw new Error(`fetch inesperado: ${metodo} ${u}`);
};

const { app } = await import('../src/server.js');
const { comentarioPorId, listarLeads, historico } = await import('../src/db.js');
let base, servidor;
const AUTH = { authorization: 'Basic ' + Buffer.from('admin:senha-teste-longa').toString('base64') };

before(async () => {
  servidor = app.listen(0, '127.0.0.1');
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

const form = (dados) => ({ method: 'POST', redirect: 'manual', headers: { ...AUTH, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(dados) });

test('painel exige login', async () => {
  assert.equal((await fetch(`${base}/painel`)).status, 401);
  assert.equal((await fetch(`${base}/painel`, { headers: AUTH })).status, 200);
});

test('POST vindo de outro site é bloqueado', async () => {
  const r = await fetch(`${base}/painel/posts`, { ...form({ entrada: 'x', ref: 'AR001' }), headers: { ...form({}).headers, origin: 'https://site-malicioso.com' } });
  assert.equal(r.status, 403);
});

test('post de outra conta / link inválido mostra erro claro', async () => {
  const r = await fetch(`${base}/painel/posts`, form({ entrada: 'https://www.instagram.com/p/NAOEXISTE/', ref: 'AR009' }));
  assert.match(decodeURIComponent(r.headers.get('location')), /Não encontrei esse post na sua conta/);
});

test('analisa o post pelo link e classifica os comentários', async () => {
  const r = await fetch(`${base}/painel/posts`, form({ entrada: 'https://www.instagram.com/p/ABC123/?igsh=xyz', ref: 'ar001', tema: 'Aposentadoria rural negada' }));
  assert.equal(r.status, 303);
  assert.match(r.headers.get('location'), /\/painel\/posts\/178001/);
  assert.equal((await comentarioPorId('c1')).temperatura, 'quente');
  assert.equal((await comentarioPorId('c2')).temperatura, 'morno');
  assert.equal((await comentarioPorId('c3')).temperatura, 'frio');
  assert.equal((await comentarioPorId('c5')), undefined, 'comentário da própria conta é ignorado');
  const pagina = await (await fetch(`${base}/painel/posts/178001`, { headers: AUTH })).text();
  assert.match(pagina, /Para aprovar \(2\)/); // c1 e c2; c4 venceu o prazo de 7 dias
  assert.ok(!pagina.includes('<script'), 'texto do comentário é escapado');
});

test('rodar a busca de novo não duplica nem reclassifica', async () => {
  const antes = chamadasClaude;
  await fetch(`${base}/painel/posts/178001/atualizar`, form({}));
  assert.equal(chamadasClaude, antes);
});

test('modo homologação bloqueia envio para conta que não é de teste', async () => {
  const n = enviados.length;
  const r = await fetch(`${base}/painel/comentarios/c2/enviar`, form({ mensagemPrivada: 'Olá!', respostaPublica: '' }));
  assert.match(decodeURIComponent(r.headers.get('location')), /modo homologação/);
  assert.equal(enviados.length, n);
  assert.equal((await comentarioPorId('c2')).status, 'pendente');
});

test('aprovação envia uma resposta privada com link do WhatsApp e cria o lead com a origem', async () => {
  const n = enviados.length;
  await fetch(`${base}/painel/comentarios/c1/enviar`, form({ mensagemPrivada: 'Olá Maria, vimos seu comentário. Quer conversar pelo WhatsApp?', respostaPublica: 'Te chamamos no direct!' }));
  const novos = enviados.slice(n);
  const privada = novos.find((e) => e.body.recipient?.comment_id === 'c1');
  assert.ok(privada, 'resposta privada enviada');
  assert.match(privada.body.message.text, /wa\.me\/5562900000000\?text=.*ref%3AAR001/);
  assert.ok(novos.some((e) => e.url.includes('/c1/replies')), 'resposta pública enviada');
  assert.equal((await comentarioPorId('c1')).status, 'enviado');
  const lead = (await listarLeads()).find((l) => l.contato === 'ig-maria');
  assert.equal(lead.origem_ref, 'AR001');
});

test('não envia duas vezes para o mesmo comentário', async () => {
  const r = await fetch(`${base}/painel/comentarios/c1/enviar`, form({ mensagemPrivada: 'de novo' }));
  assert.match(decodeURIComponent(r.headers.get('location')), /já está como "enviado"/);
});

test('comentário com mais de 7 dias não pode receber resposta privada', async () => {
  const r = await fetch(`${base}/painel/comentarios/c4/enviar`, form({ mensagemPrivada: 'oi' }));
  assert.match(decodeURIComponent(r.headers.get('location')), /7 dias/);
  assert.equal((await comentarioPorId('c4')).status, 'expirado');
});

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function mensagemWhatsapp(de, texto, id) {
  const payload = { entry: [{ changes: [{ value: { contacts: [{ wa_id: de, profile: { name: 'Maria' } }], messages: [{ from: de, id, type: 'text', text: { body: texto } }] } }] }] };
  process.env.DRY_RUN = '1'; // assinatura dispensada só neste teste (sem META_APP_SECRET)
  const r = await fetch(`${base}/webhook/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  delete process.env.DRY_RUN;
  await esperar(150);
  return r;
}

test('lead chega no WhatsApp pelo link: origem registrada e IA responde', async () => {
  const n = enviados.length;
  const r = await mensagemWhatsapp('5562911111111', 'Olá! Vi a publicação sobre Aposentadoria rural negada e gostaria de conversar. (ref:AR001)', 'wamid.A1');
  assert.equal(r.status, 200);
  const lead = (await listarLeads()).find((l) => l.contato === '5562911111111');
  assert.equal(lead.origem_ref, 'AR001');
  assert.equal((await historico(lead.id)).at(-1).autor, 'ia');
});

test('SAIR interrompe a automação sem chamar a IA', async () => {
  const antes = chamadasClaude;
  await mensagemWhatsapp('5562911111111', 'SAIR', 'wamid.A2');
  const lead = (await listarLeads()).find((l) => l.contato === '5562911111111');
  assert.equal(lead.status, 'optout');
  assert.equal(lead.ia_ativa, 0);
  assert.equal(chamadasClaude, antes);
});

test('mensagem repetida da Meta é ignorada', async () => {
  const lead = (await listarLeads()).find((l) => l.contato === '5562911111111');
  const n = (await historico(lead.id, 100)).length;
  await mensagemWhatsapp('5562911111111', 'SAIR', 'wamid.A2');
  assert.equal((await historico(lead.id, 100)).length, n);
});

test('cliente atual (sem post de origem) não é atendido pela IA nem registrado', async () => {
  const antesClaude = chamadasClaude;
  const antesEnvios = enviados.length;
  process.env.WHATSAPP_TESTE = '5562911111111,5562922222222';
  await mensagemWhatsapp('5562922222222', 'Bom dia doutor, e o meu processo?', 'wamid.B1');
  assert.equal(chamadasClaude, antesClaude);
  assert.equal(enviados.length, antesEnvios, 'nem a confirmação de leitura é enviada');
  assert.equal((await listarLeads()).find((l) => l.contato === '5562922222222'), undefined);
});

async function ecoDoApp(para, texto, id) {
  const payload = { entry: [{ changes: [{ field: 'smb_message_echoes', value: { message_echoes: [{ from: '5562900000000', to: para, id, type: 'text', text: { body: texto } }] } }] }] };
  process.env.DRY_RUN = '1';
  await fetch(`${base}/webhook/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  delete process.env.DRY_RUN;
  await esperar(50);
}

test('quando o advogado responde pelo app (coexistência), a IA sai da conversa', async () => {
  process.env.WHATSAPP_TESTE = '5562911111111,5562933333333';
  await mensagemWhatsapp('5562933333333', 'Oi, vi o post (ref:AR001)', 'wamid.C1');
  const lead = (await listarLeads()).find((l) => l.contato === '5562933333333');
  assert.equal(lead.ia_ativa, 1);
  await ecoDoApp('5562933333333', 'Olá, aqui é o Fernando. Vou te ajudar.', 'wamid.ECO1');
  const depois = (await listarLeads()).find((l) => l.contato === '5562933333333');
  assert.equal(depois.ia_ativa, 0);
  assert.equal(depois.status, 'com_advogado');
  assert.equal((await historico(lead.id)).at(-1).autor, 'humano');
  const antesClaude = chamadasClaude;
  await mensagemWhatsapp('5562933333333', 'Obrigada!', 'wamid.C2');
  assert.equal(chamadasClaude, antesClaude, 'IA não responde mais');
});

test('login aceita espaços colados sem querer e usuário em maiúsculas', async () => {
  const h = { authorization: 'Basic ' + Buffer.from('ADMIN: senha-teste-longa ').toString('base64') };
  assert.equal((await fetch(`${base}/painel`, { headers: h })).status, 200);
  const errado = { authorization: 'Basic ' + Buffer.from('admin:outra-senha-qualquer').toString('base64') };
  assert.equal((await fetch(`${base}/painel`, { headers: errado })).status, 401);
});

test('política de privacidade é pública e tem as instruções de exclusão', async () => {
  const r = await fetch(`${base}/privacidade`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Política de Privacidade/);
  assert.match(html, /id="exclusao"/);
  assert.match(html, /wa\.me\/5562900000000/);
  const ex = await fetch(`${base}/exclusao-de-dados`, { redirect: 'manual' });
  assert.equal(ex.headers.get('location'), '/privacidade#exclusao');
});
