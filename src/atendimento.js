import { config } from './config.js';
import { atualizarLead, historico, leadExistente, obterOuCriarLead, registrarMensagem } from './db.js';
import { campanhaPorPost, campanhaPorRef, extrairRef } from './campanhas.js';
import { triar } from './ia.js';
import { instagramDM, podeEnviar, whatsappMarcarLida, whatsappTexto } from './meta.js';

// Espera o lead parar de digitar antes de responder (muita gente manda 3, 4 mensagens seguidas).
const ESPERA_MS = Number(process.env.ESPERA_RESPOSTA_MS ?? 4000);

const timers = new Map();
const emAndamento = new Map();

// Pedidos de parar ou de falar com uma pessoa são tratados por regra, antes e independentemente da IA.
const PEDIDO_PARAR = /^\s*(sair|parar|pare|stop|cancelar|descadastrar|n[aã]o quero mais( mensagens)?)\s*[.!]*\s*$/i;
const PEDIDO_HUMANO = /\b(atendente|humano|falar com (o |a |um |uma )?(advogad[oa]|doutor[a]?|dr\.?|dra\.?|pessoa))\b/i;

export async function receberMensagem({ canal, contato, nome, texto, origemRef, origemPost, mensagemId }) {
  const ref = origemRef ?? extrairRef(texto);
  const existente = leadExistente(canal, contato);

  // Contato sem origem rastreada (ex.: cliente atual no número em coexistência): o sistema não guarda nem responde nada;
  // o escritório atende pelo app como sempre.
  const rastreado = ref || origemPost || existente?.origem_ref || existente?.origem_post;
  if (canal === 'whatsapp' && config.iaSomenteOrigemRastreada && !rastreado) return;
  // Modo homologação: só contatos de teste são atendidos (nem a IA é chamada).
  if (!podeEnviar(canal, [contato])) return;

  const lead = obterOuCriarLead({ canal, contato, nome, origemRef: ref, origemPost });
  registrarMensagem(lead.id, 'lead', texto);
  if (canal === 'whatsapp' && mensagemId) whatsappMarcarLida(mensagemId).catch(() => {});

  if (PEDIDO_PARAR.test(texto)) {
    atualizarLead(lead.id, { status: 'optout', ia_ativa: 0 });
    const msg = 'Tudo bem, não enviaremos mais mensagens automáticas. Se precisar, é só escrever aqui novamente.';
    await enviar(canal, contato, msg).catch((e) => console.error('Falha ao confirmar opt-out:', e.message));
    registrarMensagem(lead.id, 'ia', msg);
    return;
  }
  if (PEDIDO_HUMANO.test(texto) && lead.ia_ativa) {
    atualizarLead(lead.id, { status: 'com_advogado', ia_ativa: 0 });
    const msg = 'Certo! Vou passar sua conversa para a equipe do escritório, que continua o atendimento por aqui.';
    await enviar(canal, contato, msg).catch((e) => console.error('Falha ao confirmar handoff:', e.message));
    registrarMensagem(lead.id, 'ia', msg);
    await avisarAdvogado({ ...lead, status: 'com_advogado', resumo: 'O lead pediu atendimento humano.' }, campanhaPorRef(lead.origem_ref))
      .catch((e) => console.error('Falha ao avisar advogado:', e.message));
    return;
  }

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
  // Em coexistência o advogado já vê a conversa no app; não há como mandar aviso para o próprio número.
  const destino = config.escritorio.whatsappAdvogado !== config.meta.whatsappNumero ? config.escritorio.whatsappAdvogado : '';
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
  console.log(`[lead ${lead.id}] encaminhado ao advogado`);
  if (destino) await whatsappTexto(destino, texto);
}
