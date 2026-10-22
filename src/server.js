import express from 'express';
import { config } from './config.js';
import { assinaturaValida } from './meta.js';
import { processarWebhookWhatsapp } from './whatsapp.js';
import { processarWebhookInstagram } from './instagram.js';
import { atualizarLead, historico, leadPorId, listarLeads, registrarMensagem } from './db.js';
import { carregarCampanhas, linkWhatsapp } from './campanhas.js';
import { enviar } from './atendimento.js';
import { autenticar, painel } from './painel.js';

const app = express();
app.use(express.json({ verify: (req, _res, buf) => (req.rawBody = buf) }));

// ---------- Webhooks da Meta ----------

// Verificação feita pela Meta quando você cadastra a URL do webhook no painel.
function verificar(req, res) {
  const ok = req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.meta.verifyToken;
  return ok ? res.send(req.query['hub.challenge']) : res.sendStatus(403);
}

function webhook(secret, processar) {
  return (req, res) => {
    if (!assinaturaValida(req.rawBody, req.get('x-hub-signature-256'), secret())) return res.sendStatus(401);
    // A Meta exige resposta rápida; o atendimento roda em segundo plano.
    res.sendStatus(200);
    processar(req.body).catch((e) => console.error('Erro ao processar webhook', e));
  };
}

app.get('/webhook/whatsapp', verificar);
app.post('/webhook/whatsapp', webhook(() => config.meta.appSecret, processarWebhookWhatsapp));
app.get('/webhook/instagram', verificar);
app.post('/webhook/instagram', webhook(() => config.instagram.appSecret, processarWebhookInstagram));

// ---------- Painel administrativo ----------

const admin = autenticar;
app.use('/painel', painel);

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

app.get('/leads', admin, (req, res) => {
  const leads = listarLeads();
  if (req.accepts(['html', 'json']) === 'json') return res.json(leads);
  const linhas = leads
    .map(
      (l) => `<tr>
        <td>${l.id}</td><td>${esc(l.criado_em)}</td><td>${esc(l.nome)}</td>
        <td>${l.canal === 'whatsapp' ? `<a href="https://wa.me/${esc(l.contato)}">${esc(l.contato)}</a>` : `IG ${esc(l.contato)}`}</td>
        <td>${esc(l.origem_ref)}</td><td>${esc(l.area)}</td><td><b>${esc(l.status)}</b></td>
        <td>${l.ia_ativa ? 'IA' : 'humano'}</td><td>${esc(l.resumo)}</td>
      </tr>`,
    )
    .join('');
  res.send(`<!doctype html><meta charset="utf-8"><title>Leads</title>
    <style>body{font-family:system-ui;margin:16px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px;font-size:14px;vertical-align:top}</style>
    <h1>Leads (${leads.length})</h1>
    <table><tr><th>#</th><th>Data</th><th>Nome</th><th>Contato</th><th>Post</th><th>Área</th><th>Status</th><th>Atendimento</th><th>Resumo</th></tr>${linhas}</table>`);
});

app.get('/leads/:id/conversa', admin, (req, res) => res.json(historico(Number(req.params.id), 500)));

// Pausar a IA (o advogado assume) ou devolver o atendimento para a IA.
app.post('/leads/:id/ia', admin, (req, res) => {
  atualizarLead(Number(req.params.id), { ia_ativa: req.body?.ativa ? 1 : 0 });
  res.sendStatus(204);
});

// Links wa.me de cada post, para colocar na legenda, bio, stories ou anúncio.
app.get('/campanhas/links', admin, (_req, res) => {
  res.json(carregarCampanhas().map((c) => ({ ref: c.ref, titulo: c.titulo, link: linkWhatsapp(c) })));
});

// Envio manual de mensagem pelo escritório (só dentro da janela de 24h do WhatsApp).
app.post('/leads/:id/mensagem', admin, async (req, res) => {
  const lead = leadPorId(Number(req.params.id));
  if (!lead || !req.body?.texto) return res.sendStatus(400);
  await enviar(lead.canal, lead.contato, req.body.texto);
  registrarMensagem(lead.id, 'humano', req.body.texto);
  res.sendStatus(204);
});

app.get('/', (_req, res) => res.redirect('/painel'));

if (process.argv[1] === new URL(import.meta.url).pathname) {
  app.listen(config.port, () => console.log(`lead-prev ouvindo na porta ${config.port}`));
}

export { app };
