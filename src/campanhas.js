import { readFileSync } from 'node:fs';
import { config } from './config.js';

let cache;

export function carregarCampanhas() {
  if (!cache) {
    cache = JSON.parse(readFileSync(config.campanhasPath, 'utf8')).campanhas ?? [];
  }
  return cache;
}

export function campanhaPorRef(ref) {
  if (!ref) return undefined;
  return carregarCampanhas().find((c) => c.ref.toUpperCase() === ref.toUpperCase());
}

export function campanhaPorPost(mediaId) {
  return carregarCampanhas().find((c) => c.postIds?.includes(mediaId));
}

// O link do WhatsApp leva a marca "(ref:XXX)" no texto, que identifica o post de origem.
export function extrairRef(texto) {
  const m = /\(ref:([A-Za-z0-9_-]+)\)/.exec(texto ?? '');
  return m?.[1];
}

export function linkWhatsapp(campanha) {
  const texto = `${campanha.mensagemInicial} (ref:${campanha.ref})`;
  return `https://wa.me/${config.meta.whatsappNumero}?text=${encodeURIComponent(texto)}`;
}

function normalizar(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function comentarioDisparaResposta(campanha, texto) {
  const t = normalizar(texto ?? '');
  return campanha.palavrasChave.some((p) => new RegExp(`\\b${normalizar(p)}\\b`).test(t));
}
