import express from 'express';
import { config } from './config.js';
import { comentarioPorId, comentariosDoPost, listarPosts, postPorMidia } from './db.js';
import { analisarPost, enviarParaComentario, ErroUsuario, ignorarComentario, prazoRespostaPrivada } from './posts.js';

export const painel = express.Router();
painel.use(express.urlencoded({ extended: false }));

// Autenticação HTTP Basic (usuário "admin" ou PAINEL_USUARIO, senha = ADMIN_TOKEN) ou Bearer ADMIN_TOKEN para uso por API.
export function autenticar(req, res, next) {
  const [tipo, cred] = (req.get('authorization') ?? '').split(' ');
  if (tipo === 'Bearer' && config.adminToken && cred === config.adminToken) {
    req.usuario = 'api';
    return next();
  }
  const [usuarioDigitado, senhaDigitada] = tipo === 'Basic' ? Buffer.from(cred ?? '', 'base64').toString().split(/:(.*)/s) : [];
  const usuario = usuarioDigitado?.trim();
  const senha = senhaDigitada?.trim();
  const motivo = !config.adminToken
    ? 'ADMIN_TOKEN não configurado (vazio, com texto de exemplo ou com menos de 12 caracteres)'
    : usuario?.toLowerCase() !== config.painelUsuario.toLowerCase()
      ? `usuário digitado diferente de PAINEL_USUARIO (esperado: "${config.painelUsuario}")`
      : senha !== config.adminToken
        ? `senha diferente do ADMIN_TOKEN (digitada com ${senha?.length ?? 0} caracteres; configurada com ${config.adminToken.length})`
        : '';
  if (motivo) {
    if (tipo) console.warn(`Login recusado no painel: ${motivo}`);
    res.set('WWW-Authenticate', 'Basic realm="lead-prev", charset="UTF-8"');
    return res.status(401).send('Acesso restrito: usuário ou senha incorretos.');
  }
  req.usuario = usuario;
  // Proteção contra envio de formulário a partir de outro site.
  if (req.method === 'POST') {
    const origem = req.get('origin') ?? req.get('referer');
    if (origem && new URL(origem).host !== req.get('host')) return res.sendStatus(403);
  }
  next();
}
painel.use(autenticar);

export const dataHora = (d) =>
  d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '—';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const homologacao = () => process.env.MODO_HOMOLOGACAO !== '0';

export function pagina(titulo, corpo) {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)}</title>
<style>
  :root{--bg:#f6f7f9;--card:#fff;--txt:#1d2430;--muted:#5d6878;--borda:#dde1e7;--quente:#c0392b;--morno:#d68910;--frio:#7f8c8d;--ok:#1e8449;--azul:#1f5fa8}
  @media (prefers-color-scheme:dark){:root{--bg:#14171c;--card:#1d2128;--txt:#e6e9ee;--muted:#9aa4b2;--borda:#2e343d}}
  *{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--txt)}
  main{max-width:960px;margin:0 auto;padding:16px}a{color:var(--azul)}
  .card{background:var(--card);border:1px solid var(--borda);border-radius:10px;padding:14px;margin:12px 0}
  .aviso{border-left:4px solid var(--morno)}.erro{border-left:4px solid var(--quente)}.sucesso{border-left:4px solid var(--ok)}
  input,textarea{width:100%;padding:8px;border:1px solid var(--borda);border-radius:6px;background:var(--bg);color:var(--txt);font:inherit}
  textarea{min-height:90px}label{display:block;margin:8px 0 4px;color:var(--muted);font-size:13px}
  button{padding:8px 14px;border:0;border-radius:6px;font:inherit;cursor:pointer;background:var(--azul);color:#fff}
  button.sec{background:transparent;color:var(--muted);border:1px solid var(--borda)}
  .linha{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.muted{color:var(--muted);font-size:13px}
  .tag{display:inline-block;padding:2px 8px;border-radius:99px;color:#fff;font-size:12px;font-weight:600}
  .quente,.com_advogado,.qualificado{background:var(--quente)}.morno,.em_triagem,.novo{background:var(--morno)}.frio,.fora_do_escopo,.descartado,.optout{background:var(--frio)}
  table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid var(--borda);text-align:left}
  blockquote{margin:8px 0;padding:8px 12px;border-left:3px solid var(--borda);white-space:pre-wrap}
</style>
<main>
<p class="muted"><a href="/painel">Posts</a> · <a href="/leads">Leads</a></p>
${homologacao() ? '<div class="card aviso"><b>Modo homologação ligado.</b> Mensagens só saem para as contas de teste (INSTAGRAM_TESTE / WHATSAPP_TESTE).</div>' : ''}
${corpo}
</main></html>`;
}

function alerta(req) {
  if (req.query.erro) return `<div class="card erro">${esc(req.query.erro)}</div>`;
  if (req.query.ok) return `<div class="card sucesso">${esc(req.query.ok)}</div>`;
  return '';
}

painel.get('/', async (req, res) => {
  const posts = await listarPosts();
  const linhas = posts
    .map(
      (p) => `<tr><td><a href="/painel/posts/${esc(p.media_id)}"><b>${esc(p.ref)}</b></a></td><td>${esc(p.tema)}</td>
        <td>${p.comentarios}</td><td><b>${p.quentes}</b></td><td>${p.leads}</td>
        <td class="muted">${esc(dataHora(p.analisado_em))}</td></tr>`,
    )
    .join('');
  res.send(
    pagina(
      'Posts',
      `<h1>Encontrar leads nos comentários</h1>${alerta(req)}
      <form class="card" method="post" action="/painel/posts">
        <label>Link do post/reel do escritório, ou ID da mídia do anúncio</label>
        <input name="entrada" required placeholder="https://www.instagram.com/p/XXXXXXXX/">
        <div class="linha">
          <div style="flex:1;min-width:140px"><label>Código do post</label><input name="ref" required placeholder="AR001" pattern="[A-Za-z]{2,5}[0-9]{3}"></div>
          <div style="flex:3;min-width:200px"><label>Tema (opcional)</label><input name="tema" placeholder="Aposentadoria rural: documentos"></div>
        </div>
        <p><button>Buscar e classificar comentários</button></p>
        <p class="muted">A busca usa a API oficial do Instagram e só funciona para publicações da conta do escritório. Pode levar até um minuto.</p>
      </form>
      ${posts.length ? `<div class="card"><table><tr><th>Código</th><th>Tema</th><th>Comentários</th><th>Quentes</th><th>Leads</th><th>Última busca</th></tr>${linhas}</table></div>` : ''}`,
    ),
  );
});

painel.post('/posts', async (req, res) => {
  try {
    const r = await analisarPost({ entrada: req.body.entrada, ref: req.body.ref, tema: req.body.tema });
    const ok = `${r.totalComentarios} comentários encontrados, ${r.novos} novos, ${r.classificados} classificados.`;
    res.redirect(303, `/painel/posts/${encodeURIComponent(r.post.media_id)}?ok=${encodeURIComponent(ok)}`);
  } catch (e) {
    if (!(e instanceof ErroUsuario)) console.error('Erro ao analisar post:', e.message);
    res.redirect(303, `/painel?erro=${encodeURIComponent(e.message)}`);
  }
});

painel.post('/posts/:mediaId/atualizar', async (req, res) => {
  const destino = `/painel/posts/${encodeURIComponent(req.params.mediaId)}`;
  try {
    const r = await analisarPost({ entrada: req.params.mediaId });
    res.redirect(303, `${destino}?ok=${encodeURIComponent(`${r.novos} comentários novos, ${r.classificados} classificados.`)}`);
  } catch (e) {
    res.redirect(303, `${destino}?erro=${encodeURIComponent(e.message)}`);
  }
});

function cartaoComentario(c) {
  const prazo = prazoRespostaPrivada(c.comentado_em);
  const vencido = prazo < new Date();
  const acionavel = c.status === 'pendente' && ['quente', 'morno'].includes(c.temperatura) && !vencido;
  const cabecalho = `<div class="linha"><span class="tag ${esc(c.temperatura ?? 'frio')}">${esc(c.temperatura ?? 'sem classificação')}</span>
    <b>@${esc(c.autor_usuario ?? 'desconhecido')}</b><span class="muted">${esc(c.beneficio ?? '')} · ${esc(c.status)}${
      c.status === 'pendente' && !vencido ? ` · resposta privada até ${prazo.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : ''
    }</span></div>
    <blockquote>${esc(c.texto)}</blockquote><p class="muted">${esc(c.motivo ?? '')}</p>`;
  if (!acionavel) return `<div class="card">${cabecalho}${c.erro ? `<p class="muted">Erro: ${esc(c.erro)}</p>` : ''}</div>`;
  return `<div class="card">${cabecalho}
    <form method="post" action="/painel/comentarios/${esc(c.id)}/enviar">
      <label>Mensagem privada (Direct). O link do WhatsApp com o código do post é acrescentado automaticamente.</label>
      <textarea name="mensagemPrivada">${esc(c.mensagem_privada)}</textarea>
      <label>Resposta pública no comentário (deixe vazio para não responder)</label>
      <input name="respostaPublica" value="${esc(c.resposta_publica)}">
      <p class="linha"><button>Aprovar e enviar</button>
      <button class="sec" formaction="/painel/comentarios/${esc(c.id)}/ignorar">Ignorar</button></p>
    </form></div>`;
}

painel.get('/posts/:mediaId', async (req, res) => {
  const post = await postPorMidia(req.params.mediaId);
  if (!post) return res.status(404).send(pagina('Post', '<p>Post não encontrado.</p>'));
  const comentarios = await comentariosDoPost(post.media_id);
  const pendentes = comentarios.filter((c) => c.status === 'pendente' && ['quente', 'morno'].includes(c.temperatura));
  const demais = comentarios.filter((c) => !pendentes.includes(c));
  res.send(
    pagina(
      post.ref,
      `<h1>${esc(post.ref)} · ${esc(post.tema)}</h1>${alerta(req)}
      <p class="linha">${post.permalink ? `<a href="${esc(post.permalink)}" target="_blank" rel="noopener">Abrir no Instagram</a>` : ''}
        <form method="post" action="/painel/posts/${esc(post.media_id)}/atualizar"><button class="sec">Buscar comentários novos</button></form></p>
      <h2>Para aprovar (${pendentes.length})</h2>
      ${pendentes.map(cartaoComentario).join('') || '<p class="muted">Nenhum comentário quente ou morno aguardando.</p>'}
      <details><summary>Demais comentários (${demais.length})</summary>${demais.map(cartaoComentario).join('')}</details>`,
    ),
  );
});

async function decidir(req, res, acao) {
  const id = req.params.id;
  let mediaId;
  try {
    mediaId = (await comentarioPorId(id))?.media_id;
    await acao();
    res.redirect(303, `/painel/posts/${encodeURIComponent(mediaId)}?ok=${encodeURIComponent('Feito.')}`);
  } catch (e) {
    if (!(e instanceof ErroUsuario)) console.error('Erro ao decidir comentário:', e.message);
    res.redirect(303, `/painel/posts/${encodeURIComponent(mediaId ?? '')}?erro=${encodeURIComponent(e.message)}`);
  }
}

painel.post('/comentarios/:id/enviar', (req, res) =>
  decidir(req, res, () =>
    enviarParaComentario(
      req.params.id,
      { mensagemPrivada: req.body.mensagemPrivada, respostaPublica: req.body.respostaPublica },
      req.usuario,
    ),
  ),
);

painel.post('/comentarios/:id/ignorar', (req, res) => decidir(req, res, () => ignorarComentario(req.params.id, req.usuario)));
