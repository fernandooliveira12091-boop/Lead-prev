// Conversa com a IA pelo terminal, como se você fosse um lead no WhatsApp.
// Não envia nada à Meta; precisa só da ANTHROPIC_API_KEY.
//   npm run simular            (lead sem origem)
//   npm run simular -- BPC01   (lead que veio do post BPC01)
process.env.DRY_RUN = '1';
process.env.ESPERA_RESPOSTA_MS = '0';

const readline = await import('node:readline/promises');
const { receberMensagem } = await import('../src/atendimento.js');
const { historico, obterOuCriarLead } = await import('../src/db.js');

const contato = `sim-${Date.now()}`;
const origemRef = process.argv[2];
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log('Digite como se fosse o lead. Ctrl+C para sair.\n');

while (true) {
  const texto = await rl.question('Você: ');
  if (!texto.trim()) continue;
  const lead = await obterOuCriarLead({ canal: 'whatsapp', contato, origemRef });
  const antes = (await historico(lead.id, 1000)).length;
  await receberMensagem({ canal: 'whatsapp', contato, texto, origemRef });
  // espera a resposta da IA ser registrada
  for (let i = 0; i < 600; i++) {
    const h = await historico(lead.id, 1000);
    if (h.length > antes + 1) {
      const atual = await obterOuCriarLead({ canal: 'whatsapp', contato });
      console.log(`\nIA: ${h.at(-1).texto}\n   [status: ${atual.status} | área: ${atual.area} | IA ativa: ${atual.ia_ativa ? 'sim' : 'não'}]\n`);
      break;
    }
    if (!(await obterOuCriarLead({ canal: 'whatsapp', contato })).ia_ativa && i > 50) break;
    await new Promise((r) => setTimeout(r, 200));
  }
}
