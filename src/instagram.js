import { config } from './config.js';
import { campanhaPorPost, comentarioDisparaResposta, linkWhatsapp } from './campanhas.js';
import { jaProcessado, obterOuCriarLead, registrarMensagem } from './db.js';
import { instagramRespostaPrivada, instagramResponderComentario } from './meta.js';
import { receberMensagem } from './atendimento.js';

// Variar a resposta pública evita que o Instagram trate os comentários como spam.
const RESPOSTAS_PUBLICAS = [
  'Te chamei no direct! 📩',
  'Enviei as informações no seu direct 😉',
  'Olha seu direct, te mandei uma mensagem! 📲',
  'Respondi no privado para preservar seus dados 🔒',
];

export async function processarWebhookInstagram(body) {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field === 'comments') await tratarComentario(change.value);
    }
    for (const ev of entry.messaging ?? []) {
      await tratarDM(ev);
    }
  }
}

async function tratarComentario(c) {
  if (!c?.id || c.from?.id === config.instagram.accountId) return;
  if (c.parent_id) return; // respostas dentro de outro comentário não disparam
  if (jaProcessado(`igc:${c.id}`)) return;

  const campanha = campanhaPorPost(c.media?.id);
  if (!campanha || !comentarioDisparaResposta(campanha, c.text)) return;

  const msg =
    `Oi${c.from?.username ? ` @${c.from.username}` : ''}! Obrigado pelo comentário no post "${campanha.titulo}". 😊\n\n` +
    `Para entender o seu caso com calma e com sigilo, fale com a nossa equipe pelo WhatsApp:\n${linkWhatsapp(campanha)}\n\n` +
    `Se preferir, pode responder aqui mesmo no direct.`;

  await instagramRespostaPrivada(c.id, msg);
  const publica = RESPOSTAS_PUBLICAS[Math.floor(Math.random() * RESPOSTAS_PUBLICAS.length)];
  await instagramResponderComentario(c.id, publica).catch((e) => console.error('Resposta pública falhou', e.message));

  const lead = obterOuCriarLead({
    canal: 'instagram',
    contato: c.from.id,
    nome: c.from.username ? `@${c.from.username}` : null,
    origemRef: campanha.ref,
    origemPost: c.media.id,
  });
  registrarMensagem(lead.id, 'lead', `[comentou no post "${campanha.titulo}"]: ${c.text}`);
  registrarMensagem(lead.id, 'ia', msg);
}

async function tratarDM(ev) {
  const m = ev.message;
  if (!m || m.is_echo || ev.sender?.id === config.instagram.accountId) return;
  if (jaProcessado(`igm:${m.mid}`)) return;

  const texto = m.text ?? (m.attachments?.length ? '[enviou um anexo/áudio]' : '');
  if (!texto) return;
  await receberMensagem({ canal: 'instagram', contato: ev.sender.id, texto });
}
