import { config } from './config.js';
import { jaProcessado } from './db.js';
import { receberMensagem } from './atendimento.js';
import { registrarComentarioWebhook } from './posts.js';

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

// Comentários novos em posts cadastrados entram na fila do painel, já classificados pela IA.
// Nada é enviado automaticamente: a resposta privada só sai com aprovação no painel.
async function tratarComentario(c) {
  if (!c?.id || jaProcessado(`igc:${c.id}`)) return;
  await registrarComentarioWebhook(c);
}

async function tratarDM(ev) {
  const m = ev.message;
  if (!m || m.is_echo || ev.sender?.id === config.instagram.accountId) return;
  if (jaProcessado(`igm:${m.mid}`)) return;

  const texto = m.text ?? (m.attachments?.length ? '[enviou um anexo/áudio]' : '');
  if (!texto) return;
  await receberMensagem({ canal: 'instagram', contato: ev.sender.id, texto });
}
