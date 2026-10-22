import { atualizarLead, jaProcessado, leadExistente, registrarMensagem } from './db.js';
import { campanhaPorPost } from './campanhas.js';
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
      // Coexistência: mensagens que o escritório envia pelo app WhatsApp Business no celular.
      for (const eco of change.field === 'smb_message_echoes' ? (v.message_echoes ?? []) : []) {
        tratarEco(eco);
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

  await receberMensagem({ canal: 'whatsapp', contato: msg.from, nome, texto, origemRef, origemPost, mensagemId: msg.id });
}

// Quando o advogado responde um lead pelo app no celular, a IA sai daquela conversa.
function tratarEco(eco) {
  if (!eco?.id || jaProcessado(`wa-eco:${eco.id}`)) return;
  const lead = leadExistente('whatsapp', eco.to);
  if (!lead) return;
  registrarMensagem(lead.id, 'humano', eco.text?.body ?? `[${eco.type ?? 'mensagem'} enviada pelo app]`);
  if (lead.ia_ativa) atualizarLead(lead.id, { ia_ativa: 0, status: lead.status === 'optout' ? 'optout' : 'com_advogado' });
}
