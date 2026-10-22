import { jaProcessado } from './db.js';
import { campanhaPorPost } from './campanhas.js';
import { whatsappMarcarLida } from './meta.js';
import { receberMensagem } from './atendimento.js';

const TIPOS_SEM_TEXTO = {
  audio: '[enviou um áudio]',
  image: '[enviou uma imagem]',
  document: '[enviou um documento]',
  video: '[enviou um vídeo]',
  sticker: '[enviou uma figurinha]',
  location: '[enviou uma localização]',
};

export async function processarWebhookWhatsapp(body) {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      const nomes = Object.fromEntries((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const msg of v.messages ?? []) {
        await tratarMensagem(msg, nomes[msg.from]);
      }
    }
  }
}

async function tratarMensagem(msg, nome) {
  if (jaProcessado(`wa:${msg.id}`)) return;

  const texto =
    msg.text?.body ??
    msg.button?.text ??
    msg.interactive?.button_reply?.title ??
    msg.interactive?.list_reply?.title ??
    TIPOS_SEM_TEXTO[msg.type] ??
    `[mensagem do tipo ${msg.type}]`;

  // Anúncios "Clique para o WhatsApp" e posts impulsionados chegam com `referral`.
  const r = msg.referral;
  const origemPost = r?.source_id;
  const origemRef = origemPost ? campanhaPorPost(origemPost)?.ref : undefined;

  whatsappMarcarLida(msg.id).catch(() => {});
  await receberMensagem({ canal: 'whatsapp', contato: msg.from, nome, texto, origemRef, origemPost });
}
