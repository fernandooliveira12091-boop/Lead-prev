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

const digitos = (n) => String(n ?? '').replace(/\D/g, '');

// A YCloud envia um evento por requisição, com nomes próprios; convertemos para o formato da Meta.
async function processarEventoYcloud(ev) {
  console.log(`Webhook da YCloud recebido: ${ev.type}`);
  if (ev.type === 'whatsapp.inbound_message.received') {
    const m = ev.whatsappInboundMessage ?? {};
    await tratarMensagem({ ...m, id: m.wamid ?? m.id, from: digitos(m.from) }, m.customerProfile?.name);
  } else if (/^whatsapp\.smb\.message\.echoes/.test(ev.type ?? '')) {
    const m = ev.whatsappMessage ?? ev.whatsappSmbMessageEcho ?? {};
    await tratarEco({ ...m, id: m.wamid ?? m.id, to: digitos(m.to) });
  } else {
    console.log(`Evento da YCloud ignorado: ${ev.type ?? 'sem tipo'}`);
  }
}

export async function processarWebhookWhatsapp(body) {
  if (typeof body?.type === 'string' && body.type.startsWith('whatsapp.')) return processarEventoYcloud(body);
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      const nomes = Object.fromEntries((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const msg of v.messages ?? []) {
        await tratarMensagem(msg, nomes[msg.from]);
      }
      // Coexistência: mensagens que o escritório envia pelo app WhatsApp Business no celular.
      for (const eco of change.field === 'smb_message_echoes' ? (v.message_echoes ?? []) : []) {
        await tratarEco(eco);
      }
    }
  }
}

async function tratarMensagem(msg, nome) {
  if (await jaProcessado(`wa:${msg.id}`)) return;

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
  const origemRef = origemPost ? (await campanhaPorPost(origemPost))?.ref : undefined;

  await receberMensagem({ canal: 'whatsapp', contato: msg.from, nome, texto, origemRef, origemPost, mensagemId: msg.id });
}

// Quando o advogado responde um lead pelo app no celular, a IA sai daquela conversa.
async function tratarEco(eco) {
  if (!eco?.id || await jaProcessado(`wa-eco:${eco.id}`)) return;
  const lead = await leadExistente('whatsapp', eco.to);
  if (!lead) return;
  await registrarMensagem(lead.id, 'humano', eco.text?.body ?? `[${eco.type ?? 'mensagem'} enviada pelo app]`);
  if (lead.ia_ativa) await atualizarLead(lead.id, { ia_ativa: 0, status: lead.status === 'optout' ? 'optout' : 'com_advogado' });
}
