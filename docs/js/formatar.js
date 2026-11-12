// Funções puras de formatação e validação (sem tocar na página).
// Testadas no Node em tests/formatar.test.mjs.

const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** 1234.5 -> "R$ 1.234,50" */
export function moeda(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return "";
  const [inteiro, centavos] = n.toFixed(2).split(".");
  return `R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${centavos}`;
}

/** 50 -> "50,00" (para preencher o campo de valor) */
export function valorParaCampo(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n.toFixed(2).replace(".", ",") : "";
}

/**
 * Entende o que a pessoa digitou no campo de valor: "50", "50,00", "R$ 1.234,50", "7.5".
 * Devolve um número com 2 casas ou NaN se não der para entender.
 */
export function valorDoTexto(texto) {
  let t = String(texto ?? "").replace(/R\$/gi, "").replace(/\s/g, "");
  if (t === "" || !/^[\d.,]+$/.test(t)) return NaN;
  if (t.includes(",")) {
    if ((t.match(/,/g) || []).length > 1) return NaN;
    t = t.replace(/\./g, "").replace(",", "."); // vírgula = decimal, ponto = milhar
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, ""); // 1.234 ou 1.234.567 = milhar
  }
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

/** "2026-12-20" -> "domingo, 20 de dezembro de 2026" (sem fuso horário: é só uma data). */
export function dataLonga(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return "";
  const data = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${DIAS[data.getUTCDay()]}, ${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

/** "2026-12-20" -> "20/12/2026" */
export function dataCurta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** Momento (ISO com fuso) -> "12/11/2026 às 14:30" no horário do navegador. */
export function dataHora(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} às ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const chaveNome = (nome) => nome.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Transforma o texto colado ("Ana\nBruno, Carla; Davi") numa lista de nomes limpos.
 * Ignora linhas vazias e nomes repetidos (também os que já existem em `existentes`).
 */
export function separarNomes(texto, existentes = []) {
  const vistos = new Set(existentes.map(chaveNome));
  const nomes = [];
  const repetidos = [];
  const longos = [];
  for (const bruto of String(texto ?? "").split(/[\r\n;,]+/)) {
    const nome = bruto.replace(/\s+/g, " ").trim();
    if (!nome) continue;
    if (nome.length > 60) {
      longos.push(nome);
      continue;
    }
    const chave = chaveNome(nome);
    if (vistos.has(chave)) {
      repetidos.push(nome);
      continue;
    }
    vistos.add(chave);
    nomes.push(nome);
  }
  return { nomes, repetidos, longos };
}

// Igual à regra do banco (supabase/migrations): o banco é quem manda, isto só avisa antes.
export const REGEX_EMAIL =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

export function normalizarEmail(texto) {
  return String(texto ?? "").trim().toLowerCase();
}

export function emailValido(texto) {
  const email = normalizarEmail(texto);
  return email.length <= 254 && REGEX_EMAIL.test(email);
}

/**
 * Chave para achar e-mails "parecidos": ignora maiúsculas, o "+qualquer-coisa" e, no Gmail, os pontos.
 * (davi+ana@gmail.com e d.avi@gmail.com caem no mesmo lugar que davi@gmail.com.)
 */
export function chaveDeEmail(email) {
  const e = normalizarEmail(email);
  const arroba = e.lastIndexOf("@");
  if (arroba < 1) return e;
  let local = e.slice(0, arroba).split("+")[0];
  let dominio = e.slice(arroba + 1);
  if (dominio === "googlemail.com") dominio = "gmail.com";
  if (dominio === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${dominio}`;
}

/**
 * Quem usa e-mail igual ou parecido com o de outra pessoa do evento.
 * Devolve Map(id -> nomes das OUTRAS pessoas com e-mail parecido); só tem quem tem parecido.
 * Não bloqueia nada (pai e filho podem dividir um e-mail): serve para o organizador conferir.
 */
export function emailsParecidos(participantes) {
  const grupos = new Map();
  for (const p of participantes) {
    if (!p.email) continue;
    const chave = chaveDeEmail(p.email);
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(p);
  }
  const resultado = new Map();
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    for (const p of grupo) resultado.set(p.id, grupo.filter((o) => o.id !== p.id).map((o) => o.nome));
  }
  return resultado;
}

/** Endereço do link que vai para os participantes. `base` = endereço da página, sem # nem ?. */
export function linkDoConvite(base, token) {
  return `${base}#/e/${token}`;
}

export function textoDoConvite(evento, link) {
  const valor = Number(evento.valor) > 0 ? ` · Valor: ${moeda(evento.valor)}` : "";
  return `🎁 Amigo secreto: ${evento.nome}\n📅 ${dataLonga(evento.data_evento)}${valor}\n\nEscolha o seu nome e deixe o seu e-mail aqui:\n${link}`;
}

export function linkWhatsapp(texto) {
  return `https://wa.me/?text=${encodeURIComponent(texto)}`;
}

export function plural(n, singular, varios) {
  return n === 1 ? singular : varios;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Descobre que tipo de chave do Supabase foi colada no config.js:
 * "publica" (publishable / anon: pode ficar no site), "secreta" (secret / service_role:
 * NUNCA pode ficar no site) ou "desconhecida".
 */
export function tipoDeChave(chave) {
  const k = String(chave ?? "").trim();
  if (k.startsWith("sb_secret_")) return "secreta";
  if (k.startsWith("sb_publishable_")) return "publica";
  const partes = k.split(".");
  if (partes.length === 3) {
    try {
      const corpo = JSON.parse(atob(partes[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (corpo.role === "service_role") return "secreta";
      if (corpo.role === "anon") return "publica";
    } catch {
      // não é um JWT legível
    }
  }
  return "desconhecida";
}
