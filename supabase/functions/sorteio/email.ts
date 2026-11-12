// Montagem dos e-mails (HTML + texto). Tudo que vem de gente (nomes, recado) passa por
// escaparHtml antes de entrar no HTML.

import type { Mensagem } from "./tipos.ts";

const DIAS = [
  "domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado",
];
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function escaparHtml(texto: string): string {
  const mapa: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return texto.replace(/[&<>"']/g, (c) => mapa[c]);
}

/** 1234.5 -> "R$ 1.234,50" (formato fixo, não depende do idioma do servidor). */
export function formatarMoeda(valor: number): string {
  const [inteiro, centavos] = valor.toFixed(2).split(".");
  return `R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${centavos}`;
}

/** "2026-12-20" -> "domingo, 20 de dezembro de 2026" (sem fuso horário: é só uma data). */
export function formatarDataLonga(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, ano, mes, dia] = m;
  const data = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
  return `${DIAS[data.getUTCDay()]}, ${Number(dia)} de ${MESES[Number(mes) - 1]} de ${ano}`;
}

export type DadosEmailSorteio = {
  nomeDestinatario: string;
  nomeTirado: string;
  evento: { nome: string; data_evento: string; valor: number; recado: string | null };
  /** número do sorteio (1 = o primeiro). A partir do 2 o e-mail avisa para ignorar os anteriores. */
  numero?: number;
};

const COR = {
  fundo: "#f6efe3",
  cartao: "#fbf6ee",
  borda: "#e6d9c3",
  texto: "#3b2a1a",
  suave: "#8a7558",
  vermelho: "#a3322a",
};

function moldura(conteudo: string): string {
  return (
    `<div style="background:${COR.fundo};padding:24px 12px;font-family:Georgia,'Times New Roman',serif;color:${COR.texto}">` +
    `<div style="max-width:480px;margin:0 auto;padding:28px;background:${COR.cartao};` +
    `border:1px solid ${COR.borda};border-radius:14px">${conteudo}</div></div>`
  );
}

export function montarEmailSorteio(d: DadosEmailSorteio): Omit<Mensagem, "para"> {
  const { evento } = d;
  const data = formatarDataLonga(evento.data_evento);
  const valor = evento.valor > 0 ? `Valor do presente: ${formatarMoeda(evento.valor)}` : "Valor do presente: livre";
  const refeito = (d.numero ?? 1) > 1;
  const aviso = refeito
    ? `ATENÇÃO: este é o sorteio nº ${d.numero}. O resultado dos e-mails anteriores deste amigo secreto NÃO vale mais: use só este.`
    : null;

  const texto = [
    `Olá, ${d.nomeDestinatario}!`,
    "",
    ...(aviso ? [aviso, ""] : []),
    `No amigo secreto "${evento.nome}" você tirou:`,
    "",
    `    ${d.nomeTirado}`,
    "",
    `Data: ${data}`,
    valor,
    evento.recado ? `\n${evento.recado}` : "",
    "",
    "Shhh... não conte para ninguém!",
  ].join("\n").replace(/\n{3,}/g, "\n\n");

  const html = moldura(
    `<p style="font-size:15px;margin:0 0 6px">Olá, ${escaparHtml(d.nomeDestinatario)}!</p>` +
      (aviso
        ? `<p style="font-size:14px;margin:0 0 16px;padding:10px 12px;background:#fff1c9;color:#6b4a00;border-radius:8px"><strong>${escaparHtml(aviso)}</strong></p>`
        : "") +
      `<p style="font-size:15px;margin:0 0 22px">No amigo secreto <strong>${escaparHtml(evento.nome)}</strong> você tirou:</p>` +
      `<p style="font-size:30px;font-weight:bold;text-align:center;margin:0 0 22px;color:${COR.vermelho}">${escaparHtml(d.nomeTirado)}</p>` +
      `<p style="font-size:14px;margin:0 0 6px">📅 ${escaparHtml(data)}</p>` +
      `<p style="font-size:14px;margin:0 0 18px">🎁 ${escaparHtml(valor)}</p>` +
      (evento.recado
        ? `<p style="font-size:14px;margin:0 0 18px;padding:12px;background:#ffffff;border-radius:8px">${escaparHtml(evento.recado)}</p>`
        : "") +
      `<p style="font-size:13px;margin:0;color:${COR.suave}">Shhh... não conte para ninguém! 🤫</p>`,
  );

  const assunto = refeito
    ? `Amigo secreto: ${evento.nome} — NOVO sorteio (nº ${d.numero}), ignore o anterior`
    : `Amigo secreto: ${evento.nome} — veja quem você tirou`;
  return { assunto, html, texto };
}

export function montarEmailTeste(): Omit<Mensagem, "para"> {
  const texto = "Este é um e-mail de teste do seu site de Amigo Secreto.\n\nSe ele chegou, o envio está funcionando!";
  const html = moldura(
    `<p style="font-size:15px;margin:0 0 10px"><strong>Teste do Amigo Secreto</strong></p>` +
      `<p style="font-size:15px;margin:0">Se este e-mail chegou, o envio está funcionando! 🎁</p>`,
  );
  return { assunto: "Teste do Amigo Secreto", html, texto };
}
