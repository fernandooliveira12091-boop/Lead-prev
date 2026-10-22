import { config } from './config.js';
import { atualizarLead, historico, obterOuCriarLead, registrarMensagem } from './db.js';
import { campanhaPorPost, campanhaPorRef, extrairRef } from './campanhas.js';
import { triar } from './ia.js';
import { instagramDM, whatsappTexto } from './meta.js';

// Espera o lead parar de digitar antes de responder (muita gente manda 3, 4 mensagens seguidas).
const ESPERA_MS = Number(process.env.ESPERA_RESPOSTA_MS ?? 4000);

const timers = new Map();
const emAndamento = new Map();

export async function receberMensagem({ canal, contato, nome, texto, origemRef, origemPost }) {
  const ref = origemRef ?? extrairRef(texto);
  const lead = obterOuCriarLead({ canal, contato, nome, origemRef: ref, origemPost });
  registrarMensagem(lead.id, 'lead', texto);

  if (lead.status === 'optout') {
    // A própria pessoa voltou a escrever: retoma o atendimento.
    atualizarLead(lead.id, { status: 'em_triagem', ia_ativa: 1 });
  } else if (!lead.ia_ativa) {
    return; // caso já está com o advogado; a IA não interfere
  }

  clearTimeout(timers.get(lead.id));
  timers.set(
    lead.id,
    setTimeout(() => {
      timers.delete(lead.id);
      responder(lead.id, canal, contato).catch((e) => console.error('Erro no atendimento', lead.id, e));
    }, ESPERA_MS),
  );
}

async function responder(leadId, canal, contato) {
  // Uma resposta por vez por lead; se chegou mensagem nova durante o processamento, roda de novo.
  if (emAndamento.has(leadId)) {
    emAndamento.set(leadId, true);
    return;
  }
  emAndamento.set(leadId, false);
  try {
    do {
      emAndamento.set(leadId, false);
      await responderUmaVez(leadId, canal, contato);
    } while (emAndamento.get(leadId));
  } finally {
    emAndamento.delete(leadId);
  }
}

async function responderUmaVez(leadId, canal, contato) {
  const lead = obterOuCriarLead({ canal, contato });
  if (!lead.ia_ativa) return;
  const campanha = campanhaPorRef(lead.origem_ref) ?? campanhaPorPost(lead.origem_post);

  const t = await triar({ lead, campanha, historico: historico(leadId) });

  if (t.resposta.trim()) {
    await enviar(canal, contato, t.resposta);
    registrarMensagem(leadId, 'ia', t.resposta);
  }

  const dados = { ...JSON.parse(lead.dados_json ?? '{}'), fatos: t.fatos_relevantes };
  const campos = {
    nome: t.nome ?? lead.nome,
    area: t.area !== 'indefinido' ? t.area : (lead.area ?? campanha?.tema ?? null),
    status: t.status,
    resumo: t.resumo_para_advogado || lead.resumo,
    dados_json: JSON.stringify(dados),
    consentimento_lgpd: t.consentimento_lgpd || lead.consentimento_lgpd ? 1 : 0,
  };
  if (t.optout) Object.assign(campos, { status: 'optout', ia_ativa: 0 });
  else if (t.encaminhar_advogado) Object.assign(campos, { status: 'com_advogado', ia_ativa: 0 });
  else if (t.status === 'descartado') campos.ia_ativa = 0;
  atualizarLead(leadId, campos);

  if (t.encaminhar_advogado && !t.optout) {
    await avisarAdvogado({ ...lead, ...campos }, campanha).catch((e) => console.error('Falha ao avisar advogado', e));
  }
}

export function enviar(canal, contato, texto) {
  return canal === 'whatsapp' ? whatsappTexto(contato, texto) : instagramDM(contato, texto);
}

async function avisarAdvogado(lead, campanha) {
  const destino = config.escritorio.whatsappAdvogado;
  const contato = lead.canal === 'whatsapp' ? `https://wa.me/${lead.contato}` : `Instagram (id ${lead.contato})`;
  const fatos = JSON.parse(lead.dados_json ?? '{}').fatos ?? [];
  const texto = [
    '🔔 *Novo lead para atendimento*',
    `Nome: ${lead.nome ?? 'não informado'}`,
    `Área: ${lead.area ?? 'indefinida'}`,
    `Origem: ${campanha ? `${campanha.titulo} (${campanha.ref})` : 'direto'}`,
    `Contato: ${contato}`,
    '',
    lead.resumo ?? '',
    ...fatos.map((f) => `• ${f}`),
  ].join('\n');
  console.log(`[lead ${lead.id}] encaminhado ao advogado\n${texto}`);
  if (destino) await whatsappTexto(destino, texto);
}
