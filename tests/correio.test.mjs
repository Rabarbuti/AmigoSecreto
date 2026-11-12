import { test } from "node:test";
import assert from "node:assert/strict";
import { correioAppsScript } from "../supabase/functions/sorteio/correio.ts";
import {
  avaliarCorreioDoAmbiente, chaveSecreta, criarCorreioDoAmbiente, listaDeOrganizadores, urlDaPonteValida,
} from "../supabase/functions/sorteio/ambiente.ts";

const URL_PONTE = "https://script.google.com/macros/s/ID-SECRETO-DA-IMPLANTACAO/exec";
const msg = { para: "ana@exemplo.com", assunto: "Oi", html: "<b>oi</b>", texto: "oi" };

function criar(fetchFn, extra = {}) {
  return correioAppsScript({ url: URL_PONTE, segredo: "segredo-da-ponte", fetchFn, ...extra });
}

test("envia o e-mail como POST com o segredo e os campos esperados", async () => {
  let chamada;
  const correio = criar(async (url, init) => {
    chamada = { url, init };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  await correio.enviar(msg);
  assert.equal(chamada.url, URL_PONTE);
  assert.equal(chamada.init.method, "POST");
  assert.equal(chamada.init.redirect, "follow");
  assert.deepEqual(JSON.parse(chamada.init.body), {
    segredo: "segredo-da-ponte",
    nome: "Amigo Secreto",
    para: "ana@exemplo.com",
    assunto: "Oi",
    html: "<b>oi</b>",
    texto: "oi",
  });
});

test("usa o nome de remetente configurado", async () => {
  let corpo;
  const correio = criar(async (_u, init) => {
    corpo = JSON.parse(init.body);
    return new Response(JSON.stringify({ ok: true }));
  }, { nomeRemetente: "Família Silva" });
  await correio.enviar(msg);
  assert.equal(corpo.nome, "Família Silva");
});

test("repassa o erro que a ponte devolve (ex.: cota diária do Gmail)", async () => {
  const correio = criar(async () =>
    new Response(JSON.stringify({ ok: false, erro: "Service invoked too many times for one day: email." }))
  );
  await assert.rejects(correio.enviar(msg), /too many times/);
});

test("resposta que não é JSON (página de erro do Google) vira uma mensagem útil", async () => {
  const correio = criar(async () => new Response("<html>Erro</html>", { status: 403 }));
  await assert.rejects(correio.enviar(msg), /inesperado \(HTTP 403\).*Qualquer pessoa/s);
});

test("falha de rede e tempo esgotado não vazam o endereço da ponte", async () => {
  const rede = criar(async () => {
    throw new TypeError(`fetch failed ${URL_PONTE}`);
  });
  await assert.rejects(rede.enviar(msg), (e) => {
    assert.match(e.message, /Não consegui falar/);
    assert.ok(!e.message.includes("ID-SECRETO"));
    return true;
  });
  const lento = criar(async () => {
    const erro = new Error("timeout");
    erro.name = "TimeoutError";
    throw erro;
  });
  await assert.rejects(lento.enviar(msg), /demorou demais/);
});

test("cota(): pergunta à ponte quantos e-mails ainda dá para mandar hoje", async () => {
  let corpo;
  const correio = criar(async (_url, init) => {
    corpo = JSON.parse(init.body);
    return new Response(JSON.stringify({ ok: true, cota_restante: 42 }));
  });
  assert.equal(await correio.cota(), 42);
  assert.deepEqual(corpo, { segredo: "segredo-da-ponte", acao: "cota" });
});

test("cota(): ponte que não sabe responder devolve null; falha de verdade joga erro (o núcleo trata)", async () => {
  const antiga = criar(async () => new Response(JSON.stringify({ ok: false, erro: "Faltou o assunto ou o texto do e-mail." })));
  assert.equal(await antiga.cota(), null);
  const sem = criar(async () => new Response(JSON.stringify({ ok: true })));
  assert.equal(await sem.cota(), null);
  const fora = criar(async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(fora.cota(), /Não consegui falar/);
});

test("urlDaPonteValida: https sempre; http só no seu computador", () => {
  for (const boa of [URL_PONTE, "https://script.googleusercontent.com/macros/echo", "http://host.docker.internal:8787/exec", "http://localhost:8787/exec", "http://127.0.0.1:8787/exec"]) {
    assert.ok(urlDaPonteValida(boa), boa);
  }
  for (const ruim of ["http://script.google.com/macros/s/ID/exec", "ftp://x/y", "script.google.com/macros/s/ID/exec", "", "não é url", "http://exemplo.com/exec"]) {
    assert.ok(!urlDaPonteValida(ruim), ruim);
  }
});

test("avaliarCorreioDoAmbiente: explica o que está errado em vez de fingir que não configurou", () => {
  assert.deepEqual(avaliarCorreioDoAmbiente({}), { correio: null, problema: null });
  const http = avaliarCorreioDoAmbiente({ APPS_SCRIPT_URL: "http://script.google.com/macros/s/ID/exec", APPS_SCRIPT_SEGREDO: "x" });
  assert.equal(http.correio, null);
  assert.match(http.problema, /https:\/\//);
  const certo = avaliarCorreioDoAmbiente({ APPS_SCRIPT_URL: URL_PONTE, APPS_SCRIPT_SEGREDO: "x", NOME_REMETENTE: " Família " });
  assert.equal(typeof certo.correio.enviar, "function");
  assert.equal(typeof certo.correio.cota, "function");
  assert.equal(certo.problema, null);
});

test("listaDeOrganizadores: vazio = qualquer logado; senão e-mails em minúsculas", () => {
  assert.equal(listaDeOrganizadores(undefined), null);
  assert.equal(listaDeOrganizadores(""), null);
  assert.equal(listaDeOrganizadores(" , ; "), null);
  assert.deepEqual(listaDeOrganizadores("Ana@x.com, bruno@y.com;  carla@z.com\ndavi@w.com"), [
    "ana@x.com", "bruno@y.com", "carla@z.com", "davi@w.com",
  ]);
});

test("chaveSecreta aceita o formato novo e os antigos", () => {
  assert.equal(chaveSecreta({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_abc"}' }), "sb_secret_abc");
  assert.equal(chaveSecreta({ SUPABASE_SECRET_KEYS: '{"outra":"sb_secret_xyz"}' }), "sb_secret_xyz");
  assert.equal(chaveSecreta({ SUPABASE_SECRET_KEYS: "{quebrado", SUPABASE_SERVICE_ROLE_KEY: "antiga" }), "antiga");
  assert.equal(chaveSecreta({ SUPABASE_SECRET_KEY: "local" }), "local");
  assert.equal(chaveSecreta({}), null);
});

test("criarCorreioDoAmbiente só existe com URL e segredo", () => {
  assert.equal(criarCorreioDoAmbiente({}), null);
  assert.equal(criarCorreioDoAmbiente({ APPS_SCRIPT_URL: URL_PONTE }), null);
  assert.equal(criarCorreioDoAmbiente({ APPS_SCRIPT_URL: "  ", APPS_SCRIPT_SEGREDO: "x" }), null);
  const c = criarCorreioDoAmbiente({ APPS_SCRIPT_URL: URL_PONTE, APPS_SCRIPT_SEGREDO: "x" });
  assert.equal(typeof c.enviar, "function");
});
