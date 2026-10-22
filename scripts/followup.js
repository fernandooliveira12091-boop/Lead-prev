// Reengaja leads que pararam de responder. Rode a cada hora (cron, agendador da hospedagem etc.):
//   npm run followup
// Só alcança quem iniciou a conversa, deu consentimento e não pediu para sair.
// Usa template aprovado na Meta, pois fora da janela de 24h o WhatsApp não aceita texto livre.
import { config } from '../src/config.js';
import { atualizarLead, leadsParaFollowup, registrarMensagem } from '../src/db.js';
import { whatsappTemplate } from '../src/meta.js';

const { template, idioma, aposHoras, maxTentativas } = config.followup;
const leads = await leadsParaFollowup(aposHoras, maxTentativas);

for (const lead of leads) {
  const primeiroNome = (lead.nome ?? '').replace(/^@/, '').split(' ')[0] || 'tudo bem';
  try {
    await whatsappTemplate(lead.contato, template, idioma, [primeiroNome]);
    await registrarMensagem(lead.id, 'ia', `[follow-up: template ${template}]`);
    await atualizarLead(lead.id, { followups_enviados: lead.followups_enviados + 1 });
    console.log(`follow-up enviado para lead ${lead.id}`);
  } catch (e) {
    console.error(`falha no follow-up do lead ${lead.id}:`, e.message);
  }
}
console.log(`${leads.length} lead(s) elegível(is) para follow-up.`);
