import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escaparHtml,
  formatarDataLonga,
  formatarMoeda,
  montarEmailSorteio,
  montarEmailTeste,
} from "../supabase/functions/sorteio/email.ts";

test("escaparHtml troca os caracteres perigosos", () => {
  assert.equal(escaparHtml(`<b onclick="x">&'`), "&lt;b onclick=&quot;x&quot;&gt;&amp;&#39;");
  assert.equal(escaparHtml("Zé da Silva"), "Zé da Silva");
});

test("formatarMoeda usa vírgula e ponto de milhar", () => {
  assert.equal(formatarMoeda(50), "R$ 50,00");
  assert.equal(formatarMoeda(7.5), "R$ 7,50");
  assert.equal(formatarMoeda(1234.5), "R$ 1.234,50");
  assert.equal(formatarMoeda(1234567.89), "R$ 1.234.567,89");
  assert.equal(formatarMoeda(0), "R$ 0,00");
});

test("formatarDataLonga não sofre com fuso horário", () => {
  assert.equal(formatarDataLonga("2026-12-20"), "domingo, 20 de dezembro de 2026");
  assert.equal(formatarDataLonga("2026-12-25"), "sexta-feira, 25 de dezembro de 2026");
  assert.equal(formatarDataLonga("2027-01-01"), "sexta-feira, 1 de janeiro de 2027");
  assert.equal(formatarDataLonga("lixo"), "lixo");
});

const evento = { nome: "Natal da Família", data_evento: "2026-12-20", valor: 50, recado: null };

test("e-mail do sorteio traz o nome sorteado, a data e o valor (HTML e texto)", () => {
  const m = montarEmailSorteio({ nomeDestinatario: "Ana", nomeTirado: "Bruno", evento });
  assert.match(m.assunto, /Natal da Família/);
  for (const parte of ["Olá, Ana!", "Bruno", "Natal da Família", "domingo, 20 de dezembro de 2026", "R$ 50,00"]) {
    assert.ok(m.html.includes(parte), `HTML sem "${parte}"`);
    assert.ok(m.texto.includes(parte), `texto sem "${parte}"`);
  }
});

test("e-mail do sorteio: recado aparece só quando existe, e valor 0 vira 'livre'", () => {
  const sem = montarEmailSorteio({ nomeDestinatario: "Ana", nomeTirado: "Bruno", evento });
  assert.ok(!sem.html.includes("background:#ffffff"));
  const com = montarEmailSorteio({
    nomeDestinatario: "Ana",
    nomeTirado: "Bruno",
    evento: { ...evento, recado: "Troca na casa da vó", valor: 0 },
  });
  assert.ok(com.html.includes("Troca na casa da vó"));
  assert.ok(com.texto.includes("Troca na casa da vó"));
  assert.ok(com.texto.includes("Valor do presente: livre"));
  assert.ok(!com.texto.includes("R$"));
});

test("e-mail do sorteio: nomes e recado são escapados no HTML (nada de HTML injetado)", () => {
  const m = montarEmailSorteio({
    nomeDestinatario: '<img src=x onerror="alert(1)">',
    nomeTirado: "<script>alert(2)</script>",
    evento: { ...evento, nome: "A & B <i>", recado: "<a href='x'>clique</a>" },
  });
  assert.ok(!m.html.includes("<script"));
  assert.ok(!m.html.includes("<img"));
  assert.ok(!m.html.includes("<a href"));
  assert.ok(!m.html.includes("<i>"));
  assert.ok(m.html.includes("&lt;script&gt;alert(2)&lt;/script&gt;"));
  assert.ok(m.html.includes("A &amp; B &lt;i&gt;"));
});

test("e-mail de sorteio refeito (nº 2 em diante) avisa para ignorar os anteriores; o primeiro não", () => {
  const dados = { nomeDestinatario: "Ana", nomeTirado: "Bruno", evento };
  for (const numero of [undefined, 1]) {
    const m = montarEmailSorteio({ ...dados, numero });
    assert.ok(!m.assunto.includes("NOVO") && !m.texto.includes("ATENÇÃO") && !m.html.includes("ATENÇÃO"), `numero=${numero}`);
  }
  const m = montarEmailSorteio({ ...dados, numero: 3 });
  assert.match(m.assunto, /NOVO sorteio \(nº 3\), ignore o anterior/);
  assert.match(m.texto, /ATENÇÃO: este é o sorteio nº 3\. O resultado dos e-mails anteriores deste amigo secreto NÃO vale mais/);
  assert.ok(m.html.includes("sorteio nº 3"));
  assert.ok(m.texto.indexOf("ATENÇÃO") < m.texto.indexOf("Bruno"), "o aviso vem antes do nome sorteado");
  assert.ok(!/\n{3,}/.test(m.texto), "sem linhas em branco sobrando");
});

test("e-mail de teste existe e não menciona sorteio de ninguém", () => {
  const m = montarEmailTeste();
  assert.match(m.assunto, /Teste/);
  assert.ok(m.html.length > 50 && m.texto.length > 10);
});
