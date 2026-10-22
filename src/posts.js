import { config } from './config.js';
import { carregarCampanhas, linkWhatsapp } from './campanhas.js';
import { classificarComentarios } from './classificador.js';
import {
  atualizarComentario,
  comentarioPorId,
  comentariosSemClassificacao,
  inserirComentarios,
  marcarPostAnalisado,
  obterOuCriarLead,
  postPorMidia,
  postPorRef,
  registrarMensagem,
  salvarClassificacao,
  salvarPost,
} from './db.js';
import {
  EnvioBloqueado,
  instagramComentarios,
  instagramMidia,
  instagramMidiaPorShortcode,
  instagramRespostaPrivada,
  instagramResponderComentario,
  shortcodeDoLink,
} from './meta.js';

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

export class ErroUsuario extends Error {}

export function prazoRespostaPrivada(comentadoEm) {
  return new Date(new Date(comentadoEm).getTime() + SETE_DIAS_MS);
}

/** Aceita o link do post/reel (instagram.com/p/...) ou o ID da mídia (necessário para anúncios). */
export async function resolverMidia(entrada) {
  const valor = String(entrada ?? '').trim();
  if (/^\d{5,}$/.test(valor)) return instagramMidia(valor);
  const shortcode = shortcodeDoLink(valor);
  if (!shortcode) throw new ErroUsuario('Envie o link do post (instagram.com/p/... ou /reel/...) ou o ID da mídia.');
  const midia = await instagramMidiaPorShortcode(shortcode);
  if (!midia) {
    throw new ErroUsuario(
      'Não encontrei esse post na sua conta. Só é possível analisar publicações do próprio escritório. ' +
        'Se for um anúncio que não aparece no perfil, informe o ID da mídia do anúncio.',
    );
  }
  return midia;
}

function tituloDaLegenda(legenda) {
  const linha = (legenda ?? '').split('\n').find((l) => l.trim()) ?? 'Publicação do Instagram';
  return linha.trim().slice(0, 80);
}

export async function analisarPost({ entrada, ref, tema }) {
  const midia = await resolverMidia(entrada);
  const existente = postPorMidia(midia.id);

  const codigo = (ref ?? existente?.ref ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2,5}[0-9]{3}$/.test(codigo)) {
    throw new ErroUsuario('Informe um código para o post no formato AR001, SMR002 etc.');
  }
  const outro = postPorRef(codigo);
  if (outro && outro.media_id !== midia.id) throw new ErroUsuario(`O código ${codigo} já é de outro post.`);

  const post = salvarPost({
    mediaId: midia.id,
    ref: codigo,
    tema: tema?.trim() || existente?.tema || tituloDaLegenda(midia.caption),
    permalink: midia.permalink,
    legenda: midia.caption,
    publicadoEm: midia.timestamp,
  });

  const comentarios = (await instagramComentarios(midia.id)).filter((c) => c.autorId !== config.instagram.accountId);
  const novos = inserirComentarios(midia.id, comentarios);
  const classificados = await classificarPendentes(post);
  marcarPostAnalisado(midia.id);

  return { post, totalComentarios: comentarios.length, novos: novos.length, classificados };
}

export async function classificarPendentes(post) {
  const pendentes = comentariosSemClassificacao(post.media_id);
  if (pendentes.length === 0) return 0;
  const resultado = await classificarComentarios(post, pendentes);
  for (const c of resultado) salvarClassificacao(c.id, c);
  return resultado.length;
}

/** Comentário recebido em tempo real pelo webhook, num post já cadastrado: só registra e classifica. */
export async function registrarComentarioWebhook(c) {
  const mediaId = c.media?.id;
  let post = postPorMidia(mediaId);
  if (!post) {
    const campanha = carregarCampanhas().find((k) => k.postIds?.includes(mediaId));
    if (campanha) post = salvarPost({ mediaId, ref: campanha.ref, tema: campanha.titulo });
  }
  if (!post || !c.id || c.parent_id || c.from?.id === config.instagram.accountId) return false;
  inserirComentarios(post.media_id, [
    { id: c.id, texto: c.text ?? '', criadoEm: new Date().toISOString(), usuario: c.from?.username, autorId: c.from?.id },
  ]);
  await classificarPendentes(post);
  return true;
}

export function montarMensagemPrivada(post, texto) {
  const link = linkWhatsapp({ ref: post.ref, mensagemInicial: `Olá! Vi a publicação sobre ${post.tema} e gostaria de conversar.` });
  return `${texto.trim()}\n\nWhatsApp do escritório: ${link}`;
}

/** Envio aprovado pelo advogado: uma resposta privada (Direct) e, opcionalmente, uma resposta pública. */
export async function enviarParaComentario(id, { mensagemPrivada, respostaPublica }, decididoPor) {
  const c = comentarioPorId(id);
  if (!c) throw new ErroUsuario('Comentário não encontrado.');
  const vencido = c.status === 'expirado' || (c.status === 'pendente' && prazoRespostaPrivada(c.comentado_em) < new Date());
  if (c.status !== 'pendente' && !vencido) throw new ErroUsuario(`Este comentário já está como "${c.status}".`);
  if (vencido) {
    atualizarComentario(id, { status: 'expirado' });
    throw new ErroUsuario('Passaram 7 dias do comentário: o Instagram não permite mais resposta privada.');
  }
  const texto = (mensagemPrivada ?? c.mensagem_privada ?? '').trim();
  if (!texto) throw new ErroUsuario('A mensagem privada está vazia.');

  const post = postPorMidia(c.media_id);
  const mensagem = montarMensagemPrivada(post, texto);
  const autor = { id: c.autor_id, usuario: c.autor_usuario };

  try {
    await instagramRespostaPrivada(id, mensagem, autor);
  } catch (e) {
    if (e instanceof EnvioBloqueado) throw new ErroUsuario(`${e.message}. Adicione a conta em INSTAGRAM_TESTE ou desligue o modo homologação.`);
    atualizarComentario(id, { erro: e.message.slice(0, 300) });
    throw e;
  }
  atualizarComentario(id, {
    status: 'enviado',
    mensagem_privada: texto,
    decidido_por: decididoPor,
    decidido_em: new Date().toISOString(),
    erro: null,
  });

  const publica = (respostaPublica ?? '').trim();
  if (publica) {
    await instagramResponderComentario(id, publica, autor).catch((e) => console.error('Resposta pública falhou:', e.message));
  }

  if (c.autor_id) {
    const lead = obterOuCriarLead({
      canal: 'instagram',
      contato: c.autor_id,
      nome: c.autor_usuario ? `@${c.autor_usuario}` : null,
      origemRef: post.ref,
      origemPost: post.media_id,
    });
    registrarMensagem(lead.id, 'lead', `[comentou no post ${post.ref}]: ${c.texto}`);
    registrarMensagem(lead.id, 'humano', mensagem);
  }
}

export function ignorarComentario(id, decididoPor) {
  const c = comentarioPorId(id);
  if (!c) throw new ErroUsuario('Comentário não encontrado.');
  if (c.status !== 'pendente') return;
  atualizarComentario(id, { status: 'ignorado', decidido_por: decididoPor, decidido_em: new Date().toISOString() });
}
