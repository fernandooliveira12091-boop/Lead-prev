import { createHash } from 'node:crypto';
import { config } from './config.js';
import { consultar } from './db.js';

const DIA_MS = 24 * 60 * 60 * 1000;
const hash = (s) => createHash('sha256').update(s).digest('hex');

// ---------- Token do Instagram ----------
// O token de longa duração do Instagram vale ~60 dias e pode ser renovado (gera um novo, também de ~60 dias).
// O token renovado fica no banco; se o token do Render for trocado, ele volta a valer e a renovação recomeça dele.

const RENOVAR_A_CADA_DIAS = 7;

export async function carregarTokenInstagram() {
  const doRender = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
  if (!doRender) return;
  const [salvo] = await consultar('SELECT valor, origem_hash FROM tokens WHERE nome = $1', ['instagram']);
  if (salvo?.origem_hash === hash(doRender)) config.instagram.accessToken = salvo.valor;
}

export async function renovarTokenInstagram({ forcar = false } = {}) {
  const doRender = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
  if (!doRender) return 'sem token do Instagram configurado';
  const [salvo] = await consultar('SELECT renovado_em, origem_hash FROM tokens WHERE nome = $1', ['instagram']);
  const mesmaOrigem = salvo?.origem_hash === hash(doRender);
  if (!forcar && mesmaOrigem && Date.now() - new Date(salvo.renovado_em).getTime() < RENOVAR_A_CADA_DIAS * DIA_MS) {
    return 'renovação não necessária ainda';
  }
  const atual = mesmaOrigem ? config.instagram.accessToken : doRender;
  const url = `https://${config.instagram.graphHost}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(atual)}`;
  const r = await fetch(url);
  const json = await r.json().catch(() => ({}));
  if (!r.ok || !json.access_token) {
    // Tokens com menos de 24 h ainda não podem ser renovados; tentamos de novo no próximo ciclo.
    throw new Error(`renovação do token do Instagram falhou (${r.status}): ${json?.error?.message ?? 'sem detalhes'}`);
  }
  await consultar(
    `INSERT INTO tokens (nome, valor, origem_hash, renovado_em) VALUES ('instagram', $1, $2, now())
     ON CONFLICT (nome) DO UPDATE SET valor = excluded.valor, origem_hash = excluded.origem_hash, renovado_em = now()`,
    [json.access_token, hash(doRender)],
  );
  config.instagram.accessToken = json.access_token;
  const dias = json.expires_in ? Math.round(json.expires_in / 86400) : '?';
  return `token do Instagram renovado (válido por ~${dias} dias)`;
}

// ---------- Retenção (LGPD) ----------
// A política de privacidade promete excluir, em até 12 meses após o último contato, os dados de quem não virou cliente.
// Clientes são registrados fora deste sistema; aqui ficam só os dados da captação e da triagem.

export async function aplicarRetencao(meses = Number(process.env.RETENCAO_MESES ?? 12)) {
  const limite = `${meses} months`;
  const antigos = `SELECT id FROM leads
    WHERE GREATEST(criado_em, COALESCE(ultima_msg_lead, criado_em), COALESCE(ultima_msg_escritorio, criado_em))
          < now() - $1::interval`;
  const [{ n: mensagens }] = await consultar(
    `WITH d AS (DELETE FROM mensagens WHERE lead_id IN (${antigos}) RETURNING 1) SELECT count(*)::int AS n FROM d`,
    [limite],
  );
  const [{ n: leads }] = await consultar(`WITH d AS (DELETE FROM leads WHERE id IN (${antigos}) RETURNING 1) SELECT count(*)::int AS n FROM d`, [
    limite,
  ]);
  const [{ n: comentarios }] = await consultar(
    `WITH d AS (DELETE FROM comentarios WHERE comentado_em < now() - $1::interval RETURNING 1) SELECT count(*)::int AS n FROM d`,
    [limite],
  );
  await consultar("DELETE FROM eventos_processados WHERE criado_em < now() - interval '30 days'");
  return { leads, mensagens, comentarios };
}

// ---------- Agendamento ----------
// No plano grátis o servidor dorme; por isso a manutenção roda ao iniciar e, enquanto acordado, a cada 12 h.

export async function rodarManutencao() {
  try {
    await carregarTokenInstagram();
    console.log(await renovarTokenInstagram());
  } catch (e) {
    console.warn(`ATENÇÃO: ${e.message}`);
  }
  try {
    const r = await aplicarRetencao();
    if (r.leads || r.comentarios) console.log(`Retenção: ${r.leads} lead(s) e ${r.comentarios} comentário(s) antigos excluídos.`);
  } catch (e) {
    console.warn(`ATENÇÃO: falha na exclusão de dados antigos: ${e.message}`);
  }
}

export function agendarManutencao() {
  rodarManutencao();
  setInterval(rodarManutencao, 12 * 60 * 60 * 1000).unref();
}
