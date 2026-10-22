import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canal TEXT NOT NULL,               -- whatsapp | instagram
    contato TEXT NOT NULL,             -- telefone (wa_id) ou IG-scoped id
    nome TEXT,
    origem_ref TEXT,                   -- ref da campanha/post
    origem_post TEXT,                  -- media id do Instagram, se houver
    area TEXT,                         -- bpc_loas, aposentadoria, ...
    status TEXT NOT NULL DEFAULT 'novo', -- novo | em_triagem | qualificado | com_advogado | descartado | optout
    resumo TEXT,
    dados_json TEXT,
    consentimento_lgpd INTEGER NOT NULL DEFAULT 0,
    ia_ativa INTEGER NOT NULL DEFAULT 1,
    followups_enviados INTEGER NOT NULL DEFAULT 0,
    ultima_msg_lead TEXT,
    ultima_msg_escritorio TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (canal, contato)
  );
  CREATE TABLE IF NOT EXISTS mensagens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL REFERENCES leads(id),
    autor TEXT NOT NULL,               -- lead | ia | humano
    texto TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS posts (
    media_id TEXT PRIMARY KEY,         -- ID da mídia no Instagram (post, reel ou anúncio)
    ref TEXT NOT NULL UNIQUE,          -- código usado no link do WhatsApp (ex.: AR001)
    tema TEXT NOT NULL,
    permalink TEXT,
    legenda TEXT,
    publicado_em TEXT,
    analisado_em TEXT
  );
  CREATE TABLE IF NOT EXISTS comentarios (
    id TEXT PRIMARY KEY,               -- ID do comentário no Instagram
    media_id TEXT NOT NULL REFERENCES posts(media_id),
    autor_id TEXT,
    autor_usuario TEXT,
    texto TEXT NOT NULL,
    comentado_em TEXT NOT NULL,
    temperatura TEXT,                  -- quente | morno | frio | fora_do_escopo
    beneficio TEXT,
    motivo TEXT,
    resposta_publica TEXT,             -- sugestão da IA, editável
    mensagem_privada TEXT,             -- sugestão da IA, editável
    status TEXT NOT NULL DEFAULT 'pendente', -- pendente | enviado | ignorado | expirado | erro
    decidido_por TEXT,
    decidido_em TEXT,
    erro TEXT
  );
  CREATE INDEX IF NOT EXISTS comentarios_post_idx ON comentarios (media_id, status);
  CREATE TABLE IF NOT EXISTS eventos_processados (
    id TEXT PRIMARY KEY,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// A Meta reenvia webhooks; isso garante que cada mensagem seja tratada uma vez só.
export function jaProcessado(eventoId) {
  const r = db.prepare('INSERT OR IGNORE INTO eventos_processados (id) VALUES (?)').run(eventoId);
  return r.changes === 0;
}

export function obterOuCriarLead({ canal, contato, nome, origemRef, origemPost }) {
  db.prepare(
    `INSERT INTO leads (canal, contato, nome, origem_ref, origem_post) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (canal, contato) DO UPDATE SET
       nome = COALESCE(leads.nome, excluded.nome),
       origem_ref = COALESCE(leads.origem_ref, excluded.origem_ref),
       origem_post = COALESCE(leads.origem_post, excluded.origem_post)`,
  ).run(canal, contato, nome ?? null, origemRef ?? null, origemPost ?? null);
  return db.prepare('SELECT * FROM leads WHERE canal = ? AND contato = ?').get(canal, contato);
}

export function leadExistente(canal, contato) {
  return db.prepare('SELECT * FROM leads WHERE canal = ? AND contato = ?').get(canal, contato);
}

export function registrarMensagem(leadId, autor, texto) {
  db.prepare('INSERT INTO mensagens (lead_id, autor, texto) VALUES (?, ?, ?)').run(leadId, autor, texto);
  const coluna = autor === 'lead' ? 'ultima_msg_lead' : 'ultima_msg_escritorio';
  db.prepare(`UPDATE leads SET ${coluna} = datetime('now') WHERE id = ?`).run(leadId);
  if (autor === 'lead') {
    db.prepare('UPDATE leads SET followups_enviados = 0 WHERE id = ?').run(leadId);
  }
}

export function historico(leadId, limite = 40) {
  return db
    .prepare('SELECT autor, texto FROM mensagens WHERE lead_id = ? ORDER BY id DESC LIMIT ?')
    .all(leadId, limite)
    .reverse();
}

export function atualizarLead(leadId, campos) {
  const chaves = Object.keys(campos);
  if (chaves.length === 0) return;
  const set = chaves.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE leads SET ${set} WHERE id = ?`).run(...chaves.map((k) => campos[k]), leadId);
}

export function listarLeads() {
  return db.prepare('SELECT * FROM leads ORDER BY id DESC').all();
}

export function leadsParaFollowup(aposHoras, maxTentativas) {
  // Só reengaja quem já conversou, deu consentimento, não pediu para sair
  // e ficou em silêncio depois da última resposta do escritório.
  return db
    .prepare(
      `SELECT * FROM leads
       WHERE canal = 'whatsapp'
         AND consentimento_lgpd = 1
         AND status IN ('novo', 'em_triagem')
         AND ia_ativa = 1
         AND followups_enviados < ?
         AND ultima_msg_escritorio IS NOT NULL
         AND (ultima_msg_lead IS NULL OR ultima_msg_lead < ultima_msg_escritorio)
         AND ultima_msg_escritorio <= datetime('now', ?)`,
    )
    .all(maxTentativas, `-${aposHoras} hours`);
}

export function leadPorId(id) {
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
}

// ---------- posts e comentários ----------

export function salvarPost({ mediaId, ref, tema, permalink, legenda, publicadoEm }) {
  db.prepare(
    `INSERT INTO posts (media_id, ref, tema, permalink, legenda, publicado_em) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (media_id) DO UPDATE SET
       tema = excluded.tema, permalink = COALESCE(excluded.permalink, posts.permalink),
       legenda = COALESCE(excluded.legenda, posts.legenda), publicado_em = COALESCE(excluded.publicado_em, posts.publicado_em)`,
  ).run(mediaId, ref, tema, permalink ?? null, legenda ?? null, publicadoEm ?? null);
  return postPorMidia(mediaId);
}

export function postPorMidia(mediaId) {
  return db.prepare('SELECT * FROM posts WHERE media_id = ?').get(mediaId);
}

export function postPorRef(ref) {
  return db.prepare('SELECT * FROM posts WHERE ref = ? COLLATE NOCASE').get(ref);
}

export function listarPosts() {
  return db
    .prepare(
      `SELECT p.*,
         (SELECT count(*) FROM comentarios c WHERE c.media_id = p.media_id) AS comentarios,
         (SELECT count(*) FROM comentarios c WHERE c.media_id = p.media_id AND c.temperatura = 'quente') AS quentes,
         (SELECT count(*) FROM leads l WHERE l.origem_ref = p.ref) AS leads
       FROM posts p ORDER BY p.publicado_em DESC`,
    )
    .all();
}

export function marcarPostAnalisado(mediaId) {
  db.prepare("UPDATE posts SET analisado_em = datetime('now') WHERE media_id = ?").run(mediaId);
}

/** Insere comentários novos; devolve só os que ainda não existiam. */
export function inserirComentarios(mediaId, lista) {
  const ins = db.prepare(
    `INSERT OR IGNORE INTO comentarios (id, media_id, autor_id, autor_usuario, texto, comentado_em)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  return lista.filter((c) => ins.run(c.id, mediaId, c.autorId ?? null, c.usuario ?? null, c.texto, c.criadoEm).changes > 0);
}

export function salvarClassificacao(id, c) {
  db.prepare(
    `UPDATE comentarios SET temperatura = ?, beneficio = ?, motivo = ?, resposta_publica = ?, mensagem_privada = ?
     WHERE id = ?`,
  ).run(c.temperatura, c.beneficio, c.motivo, c.resposta_publica, c.mensagem_privada, id);
}

export function comentariosSemClassificacao(mediaId) {
  return db.prepare('SELECT * FROM comentarios WHERE media_id = ? AND temperatura IS NULL').all(mediaId);
}

const ORDEM_TEMPERATURA = "CASE temperatura WHEN 'quente' THEN 0 WHEN 'morno' THEN 1 WHEN 'frio' THEN 2 ELSE 3 END";

// O Instagram só aceita resposta privada até 7 dias após o comentário.
export function expirarComentarios() {
  db.prepare(
    `UPDATE comentarios SET status = 'expirado'
     WHERE status = 'pendente' AND julianday(comentado_em) < julianday('now', '-7 days')`,
  ).run();
}

export function comentariosDoPost(mediaId) {
  expirarComentarios();
  return db
    .prepare(`SELECT * FROM comentarios WHERE media_id = ? ORDER BY ${ORDEM_TEMPERATURA}, comentado_em DESC`)
    .all(mediaId);
}

export function comentarioPorId(id) {
  return db.prepare('SELECT * FROM comentarios WHERE id = ?').get(id);
}

export function atualizarComentario(id, campos) {
  const chaves = Object.keys(campos);
  const set = chaves.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE comentarios SET ${set} WHERE id = ?`).run(...chaves.map((k) => campos[k]), id);
}
