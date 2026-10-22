// Busca e classifica os comentários de um post do escritório, pelo terminal.
//   npm run analisar-post -- https://www.instagram.com/p/XXXX/ AR001 "Aposentadoria rural negada"
// Não envia nada: as mensagens são aprovadas no painel (/painel).
import { analisarPost } from '../src/posts.js';
import { comentariosDoPost } from '../src/db.js';

const [entrada, ref, tema] = process.argv.slice(2);
if (!entrada || !ref) {
  console.log('Uso: npm run analisar-post -- <link do post ou ID da mídia> <código, ex. AR001> ["tema"]');
  process.exit(1);
}
try {
  const r = await analisarPost({ entrada, ref, tema });
  console.log(`${r.post.ref} · ${r.post.tema}: ${r.totalComentarios} comentários (${r.novos} novos, ${r.classificados} classificados)\n`);
  for (const c of comentariosDoPost(r.post.media_id).filter((c) => ['quente', 'morno'].includes(c.temperatura))) {
    console.log(`[${c.temperatura.toUpperCase()}] @${c.autor_usuario ?? '?'} (${c.status}): ${c.texto}\n   → ${c.motivo}\n`);
  }
  console.log('Aprove as mensagens no painel: /painel');
} catch (e) {
  console.error('Erro:', e.message);
  process.exit(1);
}
