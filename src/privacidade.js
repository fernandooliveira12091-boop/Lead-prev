import { config } from './config.js';

// Página pública exigida pela Meta (política de privacidade e instruções de exclusão de dados).
// O texto é um modelo baseado na LGPD e deve ser revisado pelo advogado responsável antes do uso.

const VERSAO = '22/10/2026';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function paginaPrivacidade(_req, res) {
  const e = config.escritorio;
  const numero = config.meta.whatsappNumero;
  const whatsapp = numero
    ? `<a href="https://wa.me/${esc(numero)}">WhatsApp +${esc(numero.replace(/^(\d{2})(\d{2})(\d{5})(\d{4})$/, '$1 $2 $3-$4'))}</a>`
    : 'WhatsApp do escritório';
  const email = process.env.CONTATO_EMAIL ? ` ou pelo e-mail <a href="mailto:${esc(process.env.CONTATO_EMAIL)}">${esc(process.env.CONTATO_EMAIL)}</a>` : '';
  const contato = `${whatsapp}${email}`;

  res.set('Cache-Control', 'public, max-age=3600').send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Política de Privacidade · ${esc(e.nome)}</title>
<style>
  :root{--bg:#f6f7f9;--card:#fff;--txt:#1d2430;--muted:#5d6878;--borda:#dde1e7;--azul:#1f5fa8}
  @media (prefers-color-scheme:dark){:root{--bg:#14171c;--card:#1d2128;--txt:#e6e9ee;--muted:#9aa4b2;--borda:#2e343d;--azul:#7fb0ef}}
  *{box-sizing:border-box}body{margin:0;font:16px/1.6 system-ui,sans-serif;background:var(--bg);color:var(--txt)}
  main{max-width:820px;margin:0 auto;padding:24px 16px 48px}article{background:var(--card);border:1px solid var(--borda);border-radius:12px;padding:24px}
  h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.15rem;margin:28px 0 8px}a{color:var(--azul)}.muted{color:var(--muted);font-size:.9rem}
  li{margin:4px 0}
</style>
<main><article>
<h1>Política de Privacidade</h1>
<p class="muted">${esc(e.nome)}${e.oab ? ` · ${esc(e.oab)}` : ''} · Versão de ${VERSAO}</p>

<p>Esta política explica como tratamos os dados pessoais de quem entra em contato com o escritório pelo Instagram
(<a href="https://www.instagram.com/${esc(process.env.INSTAGRAM_USUARIO ?? '')}/">@${esc(process.env.INSTAGRAM_USUARIO ?? '')}</a>) ou pelo WhatsApp,
em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 – LGPD).</p>

<h2>1. Quem é o responsável pelos dados</h2>
<p>O controlador é ${esc(e.nome)}${e.advogado ? `, sob responsabilidade de ${esc(e.advogado)}` : ''}${e.oab ? ` (${esc(e.oab)})` : ''}.
Contato para assuntos de privacidade: ${contato}.</p>

<h2>2. Quais dados coletamos</h2>
<ul>
  <li>Nome ou nome de perfil, número de WhatsApp e identificador da conta no Instagram;</li>
  <li>O conteúdo de comentários públicos feitos nas publicações do escritório e das mensagens enviadas a nós;</li>
  <li>Informações que você decide compartilhar sobre sua situação previdenciária (por exemplo, idade, cidade, tempo de trabalho, pedidos feitos ao INSS);</li>
  <li>Qual publicação ou anúncio originou o contato.</li>
</ul>
<p>Não pedimos CPF, senhas, códigos de verificação, dados bancários ou fotos de documentos nas conversas automatizadas.
Informações de saúde só são tratadas quando você as fornece para a análise do seu caso e após a sua autorização.</p>

<h2>3. Para que usamos os dados</h2>
<ul>
  <li>Responder ao seu contato e fazer uma triagem inicial do assunto;</li>
  <li>Encaminhar o caso para análise do advogado e agendar o atendimento;</li>
  <li>Entender quais publicações do escritório geram contatos, de forma agregada.</li>
</ul>
<p>Não vendemos dados, não os usamos para publicidade de terceiros e não enviamos mensagens em massa.</p>

<h2>4. Bases legais</h2>
<ul>
  <li>Procedimentos preliminares relacionados a um possível contrato de prestação de serviços, a seu pedido (art. 7º, V, da LGPD);</li>
  <li>Consentimento (art. 7º, I), solicitado no início da conversa;</li>
  <li>Legítimo interesse do escritório para a medição agregada das publicações (art. 7º, IX);</li>
  <li>Para dados sensíveis, como os de saúde: consentimento específico (art. 11, I) ou exercício regular de direitos (art. 11, II, "d").</li>
</ul>

<h2>5. Atendimento automatizado</h2>
<p>O primeiro atendimento pode ser feito por um assistente virtual com inteligência artificial, que se identifica como tal,
faz perguntas de triagem e organiza as informações para o advogado. O assistente não presta consultoria jurídica,
não promete resultados e não decide sobre o seu caso: a análise é sempre feita por um advogado. Você pode pedir
atendimento humano a qualquer momento escrevendo "falar com o advogado".</p>

<h2>6. Com quem compartilhamos</h2>
<p>Usamos fornecedores que tratam os dados em nosso nome, somente para as finalidades acima:</p>
<ul>
  <li>Meta Platforms (Instagram e WhatsApp), canais da conversa;</li>
  <li>Anthropic (assistente de inteligência artificial);</li>
  <li>Render e Neon (hospedagem do sistema e do banco de dados).</li>
</ul>
<p>Esses fornecedores podem armazenar dados fora do Brasil, especialmente nos Estados Unidos. A transferência internacional
ocorre nas hipóteses do art. 33 da LGPD. Os dados também são protegidos pelo sigilo profissional da advocacia.</p>

<h2>7. Por quanto tempo guardamos</h2>
<p>Guardamos os dados pelo tempo necessário ao atendimento. Se você não se tornar cliente, seus dados são excluídos em até
12 meses após o último contato, salvo obrigação legal ou para o exercício regular de direitos. Se você se tornar cliente,
os dados passam a seguir as regras de guarda do contrato e da legislação aplicável.</p>

<h2>8. Seus direitos</h2>
<p>Você pode, a qualquer momento, pedir confirmação do tratamento, acesso, correção, anonimização, portabilidade, informação
sobre compartilhamento, revogação do consentimento e exclusão dos seus dados (art. 18 da LGPD), pelo ${contato}.
Também pode apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD).</p>

<h2 id="exclusao">9. Como parar as mensagens e excluir seus dados</h2>
<ul>
  <li><b>Parar as mensagens automáticas:</b> envie <b>SAIR</b> na conversa do WhatsApp ou do Instagram. A automação é interrompida na hora.</li>
  <li><b>Excluir seus dados:</b> envie "quero excluir meus dados" pelo ${contato}, informando o número de WhatsApp ou o perfil do Instagram usado no contato.
  Confirmamos a exclusão em até 15 dias, salvo dados que precisemos manter por obrigação legal.</li>
</ul>

<h2>10. Segurança</h2>
<p>O acesso ao sistema é restrito ao escritório, protegido por senha e por conexões criptografadas (HTTPS).</p>

<h2>11. Alterações</h2>
<p>Esta política pode ser atualizada. A data da versão vigente aparece no topo desta página.</p>
</article></main></html>`);
}
