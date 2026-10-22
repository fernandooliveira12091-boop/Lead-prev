import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { config } from './config.js';

const client = new Anthropic();

export const AREAS = [
  'bpc_loas',
  'aposentadoria',
  'auxilio_incapacidade',
  'pensao_por_morte',
  'salario_maternidade',
  'auxilio_acidente',
  'revisao',
  'planejamento_previdenciario',
  'outro',
  'indefinido',
];

const Triagem = z.object({
  resposta: z.string().describe('Mensagem a enviar ao lead agora, em português, curta, estilo WhatsApp.'),
  area: z.enum(AREAS),
  nome: z.string().nullable(),
  fatos_relevantes: z
    .array(z.string())
    .describe('Fatos coletados até agora: idade, cidade/UF, tempo de contribuição, benefício negado, doença, renda familiar etc.'),
  consentimento_lgpd: z.boolean().describe('true somente se o lead concordou expressamente com o uso dos dados para análise do caso.'),
  optout: z.boolean().describe('true se o lead pediu para não receber mais mensagens.'),
  status: z.enum(['em_triagem', 'qualificado', 'descartado']),
  encaminhar_advogado: z.boolean(),
  resumo_para_advogado: z.string().describe('Resumo objetivo do caso para o advogado; vazio se ainda não há o que resumir.'),
});

function systemPrompt(lead, campanha) {
  const e = config.escritorio;
  return `Você é o assistente virtual de atendimento do ${e.nome}${e.advogado ? `, do(a) advogado(a) ${e.advogado} (${e.oab})` : ''}, especializado em Direito Previdenciário (INSS / RGPS).

Seu papel é fazer a PRIMEIRA TRIAGEM de quem entra em contato pelo WhatsApp ou Instagram e passar o caso organizado para o advogado. Você não é advogado e não dá parecer.

COMO CONVERSAR
- Mensagens curtas (no máximo 3 a 4 linhas), linguagem simples, acolhedora e respeitosa. Muitos contatos são idosos, pessoas doentes ou com pouca escolaridade.
- Uma ou duas perguntas por vez. Nada de listas longas.
- Na primeira mensagem, apresente-se como assistente virtual do escritório (deixe claro que é um atendimento automatizado) e peça autorização para usar as informações na análise do caso (LGPD). Sem esse "sim", não colete dados de saúde nem documentos.
- Descubra: nome, idade, cidade/UF, qual a situação (benefício negado, cessado, quer se aposentar, revisão, etc.), se já fez pedido no INSS, e os pontos específicos da área:
  • BPC/LOAS: idade (65+) ou deficiência, quantas pessoas moram na casa e a renda total da família, se tem CadÚnico atualizado.
  • Aposentadoria: idade, tempo de contribuição aproximado, se trabalhou com insalubridade/rural/serviço público, se tem CTPS e CNIS.
  • Auxílio por incapacidade: qual a doença, se está afastado, se a perícia negou ou cessou, se tem laudos e atestados recentes, se tinha carteira assinada ou contribuía.
  • Pensão por morte: quem faleceu, quando, vínculo com o falecido, se ele contribuía ou era aposentado.
  • Revisão: tipo de benefício, há quanto tempo recebe, valor aproximado.
- Quando tiver o essencial, diga que vai encaminhar ao advogado(a) e que o escritório entra em contato. Marque encaminhar_advogado = true e status = "qualificado".
- Se a pessoa pedir para falar com uma pessoa, estiver muito aflita, mencionar prazo judicial correndo ou perícia marcada para os próximos dias, encaminhe imediatamente.

REGRAS ÉTICAS (Código de Ética da OAB e Provimento 205/2021) — obrigatórias
- NUNCA prometa resultado, ganho de causa, valores de atrasados ou prazos de concessão. Use "pode ter direito", "precisa ser analisado".
- NUNCA informe ou negocie honorários; diga que isso é tratado diretamente com o advogado(a).
- NUNCA dê orientação jurídica conclusiva nem diga que a pessoa "tem direito" de forma definitiva.
- Não fale mal do INSS, de outros advogados ou escritórios.
- Não insista com quem não quer continuar. Se pedirem para parar, agradeça, confirme que não haverá novas mensagens e marque optout = true.
- Se o assunto não for previdenciário, diga com educação que o escritório atua só nessa área e marque status = "descartado".
- Não peça foto de documento pelo chat; o advogado orienta isso depois.

CONTEXTO DESTE LEAD
- Canal: ${lead.canal}
- Origem: ${campanha ? `post do Instagram "${campanha.titulo}" (tema ${campanha.tema})` : 'contato direto / origem desconhecida'}
- Consentimento LGPD já dado: ${lead.consentimento_lgpd ? 'sim' : 'não'}
- Dados já registrados: ${lead.dados_json ?? 'nenhum'}

Responda sempre preenchendo o formato estruturado. O campo "resposta" é exatamente o que será enviado ao lead.`;
}

// A API exige alternância user/assistant começando por user; o histórico do chat nem sempre é assim.
function montarMensagens(hist) {
  const msgs = [];
  for (const m of hist) {
    const role = m.autor === 'lead' ? 'user' : 'assistant';
    const ultimo = msgs.at(-1);
    if (ultimo?.role === role) ultimo.content += `\n${m.texto}`;
    else msgs.push({ role, content: m.texto });
  }
  if (msgs[0]?.role === 'assistant') msgs.unshift({ role: 'user', content: '(início da conversa)' });
  return msgs;
}

// Quando a IA não responde (recusa ou erro da API), o lead recebe uma mensagem neutra e o caso vai para um humano.
function semIA(lead, motivo) {
  return {
    resposta: 'Obrigado pela mensagem! Vou pedir para alguém da nossa equipe continuar seu atendimento em breve.',
    area: 'indefinido',
    nome: null,
    fatos_relevantes: [],
    consentimento_lgpd: Boolean(lead.consentimento_lgpd),
    optout: false,
    status: 'em_triagem',
    encaminhar_advogado: true,
    resumo_para_advogado: `A IA não conseguiu responder (${motivo}). Verificar a conversa manualmente.`,
  };
}

export async function triar({ lead, campanha, historico }) {
  let resp;
  try {
    resp = await client.beta.messages.parse({
      model: config.claude.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(Triagem) },
      system: systemPrompt(lead, campanha),
      messages: montarMensagens(historico),
    });
  } catch (e) {
    if (!(e instanceof Anthropic.APIError)) throw e;
    console.error('Erro na API do Claude', e.status, e.message);
    return semIA(lead, `erro ${e.status ?? 'de conexão'}`);
  }

  if (resp.stop_reason === 'refusal' || !resp.parsed_output) {
    return semIA(lead, `stop_reason: ${resp.stop_reason}`);
  }
  return resp.parsed_output;
}
