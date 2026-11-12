import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const SEGREDO = "segredo-de-teste-bem-comprido-123456";
const FONTE = fs.readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");

/** Carrega o Code.gs num ambiente que imita o Apps Script (MailApp, ContentService, Session). */
function carregar({ fonte = FONTE, falharAoEnviar = null } = {}) {
  const enviados = [];
  const contexto = {
    console,
    MailApp: {
      sendEmail(...args) {
        if (falharAoEnviar) throw new Error(falharAoEnviar);
        enviados.push(args);
      },
      getRemainingDailyQuota: () => 77,
    },
    ContentService: {
      MimeType: { JSON: "JSON" },
      createTextOutput: (texto) => ({
        texto,
        setMimeType(m) {
          this.mime = m;
          return this;
        },
      }),
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => "dono@gmail.com" }) },
  };
  vm.createContext(contexto);
  vm.runInContext(fonte, contexto);
  const chamar = (corpo) => {
    const bruto = typeof corpo === "string" ? corpo : JSON.stringify(corpo);
    const saida = contexto.doPost({ postData: { contents: bruto } });
    return { ...JSON.parse(saida.texto), mime: saida.mime };
  };
  return { contexto, enviados, chamar };
}

const comSegredo = FONTE.replace(/const SEGREDO = '[^']*';/, `const SEGREDO = '${SEGREDO}';`);
const pedido = {
  segredo: SEGREDO,
  nome: "Família Silva",
  para: "ana@exemplo.com",
  assunto: "Seu amigo secreto",
  html: "<b>oi</b>",
  texto: "oi",
};

test("o Code.gs de exemplo vem com o segredo padrão e recusa tudo até ser trocado", () => {
  const { chamar, enviados } = carregar();
  const r = chamar({ ...pedido, segredo: "troque-este-segredo-por-um-texto-longo-e-aleatorio" });
  assert.equal(r.ok, false);
  assert.match(r.erro, /Troque o SEGREDO/);
  assert.equal(enviados.length, 0);
});

test("com o segredo certo envia o e-mail pelo MailApp e responde em JSON", () => {
  const { chamar, enviados } = carregar({ fonte: comSegredo });
  const r = chamar(pedido);
  assert.equal(r.ok, true);
  assert.equal(r.cota_restante, 77);
  assert.equal(r.mime, "JSON");
  assert.equal(enviados.length, 1);
  // (JSON.parse/stringify: o objeto nasceu noutro "realm" do vm e tem outro Object.prototype)
  assert.deepEqual(JSON.parse(JSON.stringify(enviados[0][0])), {
    to: "ana@exemplo.com",
    subject: "Seu amigo secreto",
    body: "oi",
    name: "Família Silva",
    htmlBody: "<b>oi</b>",
  });
});

test("segredo errado, endereço inválido e campos faltando não enviam nada", () => {
  const { chamar, enviados } = carregar({ fonte: comSegredo });
  assert.match(chamar({ ...pedido, segredo: "errado" }).erro, /Segredo incorreto/);
  assert.match(chamar({ ...pedido, para: "nao-e-email" }).erro, /inválido/);
  assert.match(chamar({ ...pedido, para: "a@b.c, outro@x.com" }).erro, /inválido/);
  assert.match(chamar({ ...pedido, assunto: "" }).erro, /assunto/);
  assert.match(chamar({ ...pedido, texto: undefined }).erro, /texto/);
  assert.equal(enviados.length, 0);
});

test("segredos de exemplo públicos nunca valem, nem o de teste local do repositório", () => {
  const local = FONTE.replace(/const SEGREDO = '[^']*';/, "const SEGREDO = 'segredo-local-de-teste-com-mais-de-vinte-caracteres';");
  const { chamar, enviados } = carregar({ fonte: local });
  const r = chamar({ ...pedido, segredo: "segredo-local-de-teste-com-mais-de-vinte-caracteres" });
  assert.equal(r.ok, false);
  assert.match(r.erro, /não use o de exemplo/);
  assert.equal(enviados.length, 0);
});

test("ação 'cota' devolve quanto falta da cota do dia (só com o segredo certo)", () => {
  const { chamar, enviados } = carregar({ fonte: comSegredo });
  const r = chamar({ segredo: SEGREDO, acao: "cota" });
  assert.equal(r.ok, true);
  assert.equal(r.cota_restante, 77);
  assert.equal(enviados.length, 0, "perguntar a cota não manda e-mail");
  assert.match(chamar({ segredo: "errado", acao: "cota" }).erro, /Segredo incorreto/);
});

test("e-mails grandes demais são recusados (limita o estrago se o segredo vazar)", () => {
  const { chamar, enviados } = carregar({ fonte: comSegredo });
  assert.match(chamar({ ...pedido, assunto: "a".repeat(201) }).erro, /grande demais/);
  assert.match(chamar({ ...pedido, texto: "a".repeat(10001) }).erro, /grande demais/);
  assert.match(chamar({ ...pedido, html: "a".repeat(30001) }).erro, /grande demais/);
  assert.equal(enviados.length, 0);
  assert.equal(chamar({ ...pedido, html: "a".repeat(30000), texto: "a".repeat(10000), assunto: "a".repeat(200) }).ok, true);
});

test("nome do remetente é cortado em 80 letras", () => {
  const { chamar, enviados } = carregar({ fonte: comSegredo });
  chamar({ ...pedido, nome: "n".repeat(200) });
  assert.equal(enviados[0][0].name.length, 80);
});

test("sem nome usa o padrão e sem html manda só texto", () => {
  const { chamar, enviados } = carregar({ fonte: comSegredo });
  chamar({ ...pedido, nome: undefined, html: undefined });
  assert.equal(enviados[0][0].name, "Amigo Secreto");
  assert.ok(!("htmlBody" in enviados[0][0]));
});

test("corpo que não é JSON e erro do MailApp viram respostas ok:false (sem exceção)", () => {
  const { chamar } = carregar({ fonte: comSegredo });
  assert.equal(chamar("isto não é json").ok, false);

  const cota = carregar({ fonte: comSegredo, falharAoEnviar: "Service invoked too many times for one day: email." });
  const r = cota.chamar(pedido);
  assert.equal(r.ok, false);
  assert.match(r.erro, /too many times/);
});

test("doGet confirma que a ponte está no ar e testar() manda e-mail para a própria conta", () => {
  const { contexto, enviados } = carregar({ fonte: comSegredo });
  assert.match(contexto.doGet().texto, /no ar/);
  contexto.testar();
  assert.equal(enviados[0][0], "dono@gmail.com");
});
