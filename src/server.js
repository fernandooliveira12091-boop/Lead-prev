import express from 'express';
import { config } from './config.js';
import { assinaturaValida } from './meta.js';
import { processarWebhookWhatsapp } from './whatsapp.js';
import { processarWebhookInstagram } from './instagram.js';
import { atualizarLead, consultar, historico, leadPorId, listarLeads, registrarMensagem } from './db.js';
import { carregarCampanhas, linkWhatsapp } from './campanhas.js';
import { enviar } from './atendimento.js';
import { autenticar, dataHora, esc, pagina, painel } from './painel.js';

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

const STATUS = {
  novo: 'novo', em_triagem: 'em triagem', qualificado: 'qualificado', com_advogado: 'com o advogado',
  descartado: 'descartado', optout: 'pediu para sair',
};

app.get('/leads', admin, async (req, res) => {
  const leads = await listarLeads();
  if (req.accepts(['html', 'json']) === 'json') return res.json(leads);
  const cartoes = leads
    .map((l) => {
      const fatos = JSON.parse(l.dados_json ?? '{}').fatos ?? [];
      const contato = l.canal === 'whatsapp'
        ? `<a href="https://wa.me/${esc(l.contato)}" target="_blank" rel="noopener">Abrir no WhatsApp</a>`
        : `Instagram${l.nome?.startsWith('@') ? ` <a href="https://www.instagram.com/${esc(l.nome.slice(1))}/" target="_blank" rel="noopener">${esc(l.nome)}</a>` : ''}`;
      return `<div class="card">
        <div class="linha"><span class="tag ${esc(l.status)}">${esc(STATUS[l.status] ?? l.status)}</span>
          <b>${esc(l.nome ?? 'Sem nome')}</b>
          <span class="muted">${esc(l.area ?? 'área indefinida')} · post ${esc(l.origem_ref ?? '—')} · ${l.ia_ativa ? 'IA atendendo' : 'atendimento humano'} · ${esc(dataHora(l.criado_em))}</span></div>
        ${l.resumo ? `<blockquote>${esc(l.resumo)}</blockquote>` : ''}
        ${fatos.length ? `<ul>${fatos.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
        <p class="muted">${contato}</p></div>`;
    })
    .join('');
  res.send(pagina('Leads', `<h1>Leads (${leads.length})</h1>${cartoes || '<p class="muted">Nenhum lead ainda.</p>'}`));
});

app.get('/leads/:id/conversa', admin, async (req, res) => res.json(await historico(Number(req.params.id), 500)));

// Pausar a IA (o advogado assume) ou devolver o atendimento para a IA.
app.post('/leads/:id/ia', admin, async (req, res) => {
  await atualizarLead(Number(req.params.id), { ia_ativa: req.body?.ativa ? 1 : 0 });
  res.sendStatus(204);
});

// Links wa.me de cada post, para colocar na legenda, bio, stories ou anúncio.
app.get('/campanhas/links', admin, (_req, res) => {
  res.json(carregarCampanhas().map((c) => ({ ref: c.ref, titulo: c.titulo, link: linkWhatsapp(c) })));
});

// Envio manual de mensagem pelo escritório (só dentro da janela de 24h do WhatsApp).
app.post('/leads/:id/mensagem', admin, async (req, res) => {
  const lead = await leadPorId(Number(req.params.id));
  if (!lead || !req.body?.texto) return res.sendStatus(400);
  await enviar(lead.canal, lead.contato, req.body.texto);
  await registrarMensagem(lead.id, 'humano', req.body.texto);
  res.sendStatus(204);
});

app.get('/', (_req, res) => res.redirect('/painel'));

// Verificação de saúde usada pela hospedagem (sem dados, sem login).
app.get('/saude', (_req, res) => res.json({ ok: true }));

// Erros inesperados (ex.: banco fora do ar): mensagem clara para quem usa, detalhe técnico só no log.
app.use((err, req, res, _next) => {
  const banco = ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', '28P01', '3D000'].includes(err.code);
  console.error(`Erro em ${req.method} ${req.path}:`, err.code ?? '', err.message);
  res.status(500).send(
    pagina('Erro', banco
      ? '<div class="card erro"><b>Não foi possível acessar o banco de dados.</b> Confira a variável DATABASE_URL no Render: ela deve ser a connection string copiada da Neon (começa com postgresql://).</div>'
      : '<div class="card erro"><b>Ocorreu um erro inesperado.</b> Tente de novo em instantes; se continuar, verifique os logs.</div>'),
  );
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
  if (!config.adminToken) {
    console.warn('ATENÇÃO: ADMIN_TOKEN ausente, com texto de exemplo ou com menos de 12 caracteres; o painel ficará bloqueado.');
  }
  if (process.env.DATABASE_URL && !config.databaseUrl) console.warn('ATENÇÃO: DATABASE_URL contém o texto de exemplo; cole a connection string da Neon.');
  if (!config.databaseUrl) {
    console.warn('ATENÇÃO: DATABASE_URL não definida; usando banco temporário em memória (os dados somem ao reiniciar).');
  }
  console.log(`Modo homologação: ${process.env.MODO_HOMOLOGACAO === '0' ? 'DESLIGADO' : 'ligado'}`);
  consultar('SELECT 1')
    .then(() => console.log(config.databaseUrl ? 'Banco de dados conectado.' : 'Banco temporário em memória pronto.'))
    .catch((e) =>
      console.error(
        `ATENÇÃO: não foi possível conectar ao banco de dados (${e.code ?? e.message}). ` +
          'Copie de novo a connection string na Neon (botão Connect) e cole em DATABASE_URL.',
      ),
    );
  app.listen(config.port, () => console.log(`lead-prev ouvindo na porta ${config.port}`));
}

export { app };
