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
