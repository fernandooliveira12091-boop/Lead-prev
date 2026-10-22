import express from 'express';
import { config } from './config.js';
import { comentarioPorId, comentariosDoPost, listarPosts, postPorMidia, resultadosPorOrigem } from './db.js';
import { Analise, analisarConversa, salvarLeadManual } from './copiloto.js';
import { carregarCampanhas, linkWhatsapp } from './campanhas.js';
import { configuracao, testarConexoes } from './status.js';
import { registrarWebhook360 } from './meta.js';
import {
  analisarPost,
  enviarParaComentario,
  ErroUsuario,
  ignorarComentario,
  prazoRespostaPrivada,
  removerPost,
  resumoBusca,
} from './posts.js';

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
      ? `usuário digitado diferente de PAINEL_USUARIO (digitado com ${usuario?.length ?? 0} caracteres; configurado com ${config.painelUsuario.length})`
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
  input,textarea,select{width:100%;padding:8px;border:1px solid var(--borda);border-radius:6px;background:var(--bg);color:var(--txt);font:inherit}
  textarea{min-height:90px}form.linha select{width:auto}label{display:block;margin:8px 0 4px;color:var(--muted);font-size:13px}
  button{padding:8px 14px;border:0;border-radius:6px;font:inherit;cursor:pointer;background:var(--azul);color:#fff}
  button.sec{background:transparent;color:var(--muted);border:1px solid var(--borda)}
  .linha{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.muted{color:var(--muted);font-size:13px}
  .tag{display:inline-block;padding:2px 8px;border-radius:99px;color:#fff;font-size:12px;font-weight:600}
  .quente,.com_advogado,.qualificado{background:var(--quente)}.contratado{background:var(--ok)}.nao_prosseguiu{background:var(--frio)}.morno,.em_triagem,.novo{background:var(--morno)}.frio,.fora_do_escopo,.descartado,.optout{background:var(--frio)}
  table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid var(--borda);text-align:left}
  blockquote{margin:8px 0;padding:8px 12px;border-left:3px solid var(--borda);white-space:pre-wrap}
</style>
<main>
<p class="muted"><a href="/painel">Posts</a> · <a href="/painel/atender">Atender</a> · <a href="/leads">Leads</a> · <a href="/painel/links">Links e resultados</a> · <a href="/painel/status">Conexões</a></p>
${homologacao() ? '<div class="card aviso"><b>Modo homologação ligado.</b> Mensagens só saem para as contas de teste (INSTAGRAM_TESTE / WHATSAPP_TESTE).</div>' : ''}
${corpo}
</main></html>`;
}

export function alerta(req) {
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
    const ok = resumoBusca(r);
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
    res.redirect(303, `${destino}?ok=${encodeURIComponent(resumoBusca(r))}`);
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
        <form method="post" action="/painel/posts/${esc(post.media_id)}/atualizar"><button class="sec">Buscar comentários novos</button></form>
        <form method="post" action="/painel/posts/${esc(post.media_id)}/remover"
          onsubmit="return confirm('Remover este post e seus comentários do painel? Os leads já criados continuam salvos e o código ${esc(post.ref)} fica livre.')">
          <button class="sec">Remover do painel</button></form></p>
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

// ---------- Conexões ----------

function urlBase(req) {
  return `${req.protocol === 'http' && req.get('x-forwarded-proto') === 'https' ? 'https' : req.protocol}://${req.get('host')}`;
}

function telaStatus(req, resultados) {
  const base = urlBase(req);
  const linhas = (resultados ?? configuracao().map((c) => ({ nome: c.nome, ok: c.ok, detalhe: c.ok ? 'configurado' : `falta ${c.falta}` })))
    .map((r) => `<tr><td>${r.ok ? '✅' : '⚠️'}</td><td><b>${esc(r.nome)}</b></td><td>${esc(r.detalhe)}</td></tr>`)
    .join('');
  return pagina(
    'Conexões',
    `<h1>Conexões</h1>
    ${resultados ? '<div class="card sucesso">Teste concluído.</div>' : ''}
    <div class="card"><table><tr><th></th><th>Serviço</th><th>Situação</th></tr>${linhas}</table>
      <form method="post" action="/painel/status/testar"><p><button>Testar conexões agora</button></p></form>
      <p class="muted">O teste da IA faz uma chamada mínima ao Claude (custo de frações de centavo).</p></div>
    <div class="card"><b>Endereços para cadastrar na Meta</b>
      <p class="muted">Política de privacidade</p><blockquote>${esc(base)}/privacidade</blockquote>
      <p class="muted">Exclusão de dados</p><blockquote>${esc(base)}/exclusao-de-dados</blockquote>
      <p class="muted">Webhook do Instagram</p><blockquote>${esc(base)}/webhook/instagram</blockquote>
      ${config.whatsapp.provedor === 'ycloud'
        ? `<p class="muted">Webhook do WhatsApp (cadastre na YCloud em Developers ➜ Webhooks)</p>
           ${config.whatsapp.webhookChave
             ? `<blockquote>${esc(base)}/webhook/whatsapp?chave=${esc(config.whatsapp.webhookChave)}</blockquote>`
             : '<p>Defina WHATSAPP_WEBHOOK_CHAVE (16+ caracteres) no Render para gerar o endereço.</p>'}`
        : config.whatsapp.provedor === '360dialog'
        ? `<p class="muted">WhatsApp pela 360dialog (coexistência)</p>
           ${config.whatsapp.webhookChave
             ? `<form method="post" action="/painel/status/webhook360"><button class="sec">Cadastrar webhook do WhatsApp na 360dialog</button></form>`
             : '<p>Defina WHATSAPP_WEBHOOK_CHAVE (16+ caracteres) no Render para liberar o cadastro do webhook.</p>'}`
        : `<p class="muted">Webhook do WhatsApp</p><blockquote>${esc(base)}/webhook/whatsapp</blockquote>`}
      <p class="muted">Token de verificação: o valor de META_VERIFY_TOKEN no Render.</p></div>`,
  );
}

painel.get('/status', (req, res) => res.send(telaStatus(req)));
painel.post('/status/testar', async (req, res) => res.send(telaStatus(req, await testarConexoes())));

painel.post('/posts/:mediaId/remover', async (req, res) => {
  const post = await postPorMidia(req.params.mediaId);
  if (post) await removerPost(post.media_id);
  res.redirect(303, `/painel?ok=${encodeURIComponent(post ? `Post ${post.ref} removido do painel; o código está livre de novo.` : 'Post não encontrado.')}`);
});

// ---------- Modo copiloto: colar a conversa e receber a triagem ----------

async function opcoesCodigo(selecionado) {
  const posts = await listarPosts();
  const codigos = [...new Map([...carregarCampanhas(), ...posts].map((c) => [c.ref, c.titulo ?? c.tema])).entries()];
  return `<option value="">(sem código)</option>${codigos
    .map(([ref, titulo]) => `<option value="${esc(ref)}"${ref === selecionado ? ' selected' : ''}>${esc(ref)} · ${esc(titulo)}</option>`)
    .join('')}`;
}

const copiar = (rotulo = 'Copiar') =>
  `<button type="button" class="sec" onclick="navigator.clipboard.writeText(this.previousElementSibling.value ?? this.previousElementSibling.textContent);this.textContent='Copiado!'">${rotulo}</button>`;

painel.get('/atender', async (req, res) => {
  res.send(
    pagina(
      'Atender',
      `<h1>Atender uma conversa</h1>${alerta(req)}
      <form class="card" method="post" action="/painel/atender">
        <label>Cole aqui a conversa do WhatsApp/Direct ou o comentário (pode ser só o trecho principal)</label>
        <textarea name="texto" required style="min-height:220px" placeholder="Ex.: Boa tarde, trabalhei na roça com meu pai desde os 12 anos e o INSS negou minha aposentadoria..."></textarea>
        <p><button>Analisar com a IA</button></p>
        <p class="muted">Nada é enviado à pessoa. O texto colado não fica guardado; só o resumo, se você salvar o lead.</p>
      </form>`,
    ),
  );
});

function lista(itens) {
  return itens.length ? `<ul>${itens.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="muted">Nenhum.</p>';
}

painel.post('/atender', async (req, res) => {
  const texto = String(req.body?.texto ?? '').trim();
  if (!texto) return res.redirect(303, '/painel/atender');
  let a;
  try {
    a = await analisarConversa(texto);
  } catch (e) {
    console.error('Erro no copiloto:', e.status ?? '', e.message);
    return res.redirect(303, `/painel/atender?erro=${encodeURIComponent('Não foi possível analisar agora: ' + (e.status === 401 ? 'chave da IA inválida (veja Conexões).' : e.message))}`);
  }
  const { codigo, ...analise } = a;
  res.send(
    pagina(
      'Triagem',
      `<h1>Triagem</h1>
      <div class="card">
        <div class="linha"><span class="tag ${a.necessidade_revisao_humana ? 'quente' : 'morno'}">${a.necessidade_revisao_humana ? 'revisão do advogado' : 'continuar triagem'}</span>
          <b>${esc(a.beneficio_interesse.replaceAll('_', ' '))}</b>${codigo ? `<span class="muted">código detectado: ${esc(codigo)}</span>` : ''}</div>
        <blockquote>${esc(a.situacao_informada)}</blockquote>
        <p class="muted">${esc(a.motivo_encaminhamento)}</p>
        <table>
          <tr><td>Período rural</td><td>${esc(a.periodo_atividade_rural)}</td></tr>
          <tr><td>Categoria</td><td>${esc(a.categoria_previdenciaria)}</td></tr>
          <tr><td>Requerimento no INSS</td><td>${esc(a.requerimento_inss.replaceAll('_', ' '))}</td></tr>
          <tr><td>Documentos mencionados</td><td>${esc(a.documentos_mencionados.join('; ') || '—')}</td></tr>
        </table>
        <p><b>Informações pendentes</b></p>${lista(a.informacoes_pendentes)}
        <p><b>Contradições</b></p>${lista(a.contradicoes)}
      </div>
      <div class="card"><b>Resposta sugerida</b> <span class="muted">(revise antes de enviar)</span>
        <textarea>${esc(a.resposta_sugerida)}</textarea>${copiar('Copiar resposta')}
      </div>
      <form class="card" method="post" action="/painel/leads/novo"><b>Salvar como lead</b>
        <div class="linha">
          <div style="flex:2;min-width:200px"><label>WhatsApp (com DDD) ou @Instagram</label><input name="contato" required placeholder="61 99999-9999 ou @perfil"></div>
          <div style="flex:2;min-width:200px"><label>Nome</label><input name="nome" value="${esc(a.nome ?? '')}"></div>
          <div style="flex:2;min-width:200px"><label>Post de origem</label><select name="codigo" style="width:100%;padding:8px">${await opcoesCodigo(codigo)}</select></div>
        </div>
        <input type="hidden" name="analise" value="${esc(JSON.stringify(analise))}">
        <p><button>Salvar lead</button> <a href="/painel/atender">Analisar outra conversa</a></p>
      </form>`,
    ),
  );
});

painel.post('/leads/novo', async (req, res) => {
  try {
    let analise = null;
    if (req.body?.analise) {
      const r = Analise.safeParse(JSON.parse(req.body.analise));
      if (r.success) analise = r.data;
    }
    const lead = await salvarLeadManual({ contato: req.body?.contato, nome: req.body?.nome, codigo: req.body?.codigo, analise });
    res.redirect(303, `/leads?ok=${encodeURIComponent(`Lead salvo (#${lead.id}).`)}`);
  } catch (e) {
    res.redirect(303, `/painel/atender?erro=${encodeURIComponent(e.message)}`);
  }
});

// ---------- Links rastreados e resultados por post ----------

painel.get('/links', async (req, res) => {
  const posts = await listarPosts();
  const fontes = [...carregarCampanhas().map((c) => ({ ref: c.ref, titulo: c.titulo, mensagemInicial: c.mensagemInicial })),
    ...posts.map((p) => ({ ref: p.ref, titulo: p.tema, mensagemInicial: `Olá! Vi a publicação sobre ${p.tema} e gostaria de conversar.` }))];
  const unicos = [...new Map(fontes.map((f) => [f.ref, f])).values()];
  const resultados = Object.fromEntries((await resultadosPorOrigem()).map((r) => [r.ref, r]));
  const linhasLinks = unicos
    .map((f) => {
      const r = resultados[f.ref] ?? { leads: 0, qualificados: 0, contratados: 0 };
      return `<tr><td><b>${esc(f.ref)}</b><br><span class="muted">${esc(f.titulo)}</span></td>
        <td><input readonly value="${esc(linkWhatsapp(f))}">${copiar()}</td>
        <td>${r.leads}</td><td>${r.qualificados}</td><td>${r.contratados}</td></tr>`;
    })
    .join('');
  const semCodigo = resultados['SEM CÓDIGO'];
  res.send(
    pagina(
      'Links e resultados',
      `<h1>Links e resultados</h1>
      <div class="card"><p class="muted">Coloque o link de cada post na legenda, nos stories ou na bio. Quem clica cai no seu WhatsApp
        com o código do post na mensagem, e você sabe de onde a pessoa veio. Para novos códigos, cadastre o post na tela Posts.</p>
        <table><tr><th>Post</th><th>Link do WhatsApp</th><th>Leads</th><th>Qualificados</th><th>Contratos</th></tr>${linhasLinks}</table>
        ${semCodigo ? `<p class="muted">Leads sem código de origem: ${semCodigo.leads}.</p>` : ''}</div>`,
    ),
  );
});

painel.post('/status/webhook360', async (req, res) => {
  try {
    await registrarWebhook360(`${urlBase(req)}/webhook/whatsapp?chave=${encodeURIComponent(config.whatsapp.webhookChave)}`);
    res.send(telaStatus(req, [{ nome: 'Webhook do WhatsApp (360dialog)', ok: true, detalhe: 'cadastrado' }]));
  } catch (e) {
    res.send(telaStatus(req, [{ nome: 'Webhook do WhatsApp (360dialog)', ok: false, detalhe: e.message.slice(0, 200) }]));
  }
});
