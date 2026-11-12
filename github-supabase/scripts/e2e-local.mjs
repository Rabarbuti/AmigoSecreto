// Teste de PONTA A PONTA no Supabase LOCAL: login de verdade, regras de segurança de verdade,
// a função "sorteio" rodando de verdade no Edge Runtime e uma ponte de e-mail FALSA no lugar do Gmail.
//
// Antes (em terminais separados):
//   npm run banco:iniciar      liga o Supabase local (Docker)
//   npm run funcao:servir      serve a função "sorteio" com supabase/functions/.env
// Depois:
//   npm run test:e2e

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { iniciarPonteFalsa, SEGREDO_PADRAO } from "./ponte-falsa.mjs";

const raiz = fileURLToPath(new URL("..", import.meta.url));

function statusLocal() {
  const saida = execSync("npx supabase status -o json", {
    cwd: raiz,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return JSON.parse(saida.slice(saida.indexOf("{")));
}

const st = statusLocal();
const API = st.API_URL;
const PUB = st.PUBLISHABLE_KEY;
const ADMIN = st.SERVICE_ROLE_KEY; // só para criar/apagar os usuários de teste

let passaram = 0;
const ok = (descricao) => {
  passaram++;
  console.log(`ok - ${descricao}`);
};

async function chamar(metodo, caminho, { token, chave = PUB, corpo, cab = {} } = {}) {
  const headers = { apikey: chave, "Content-Type": "application/json", ...cab };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(API + caminho, {
    method: metodo,
    headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let dados = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = texto;
  }
  return { status: r.status, dados, headers: r.headers };
}

const rest = (metodo, caminho, token, corpo, cab) =>
  chamar(metodo, `/rest/v1/${caminho}`, { token, corpo, cab: { Prefer: "return=representation", ...cab } });
const rpc = (nome, args, token) => chamar("POST", `/rest/v1/rpc/${nome}`, { token, corpo: args });
const funcao = (token, corpo) => chamar("POST", "/functions/v1/sorteio", { token, corpo });

async function criarUsuario(email, senha) {
  const r = await chamar("POST", "/auth/v1/admin/users", {
    chave: ADMIN,
    token: ADMIN,
    corpo: { email, password: senha, email_confirm: true },
  });
  assert.equal(r.status, 200, `criar usuário: ${JSON.stringify(r.dados)}`);
  return r.dados.id;
}

async function entrar(email, senha) {
  const r = await chamar("POST", "/auth/v1/token?grant_type=password", { corpo: { email, password: senha } });
  assert.equal(r.status, 200, `login: ${JSON.stringify(r.dados)}`);
  return r.dados.access_token;
}

/** Lê dos e-mails recebidos: nome -> quem tirou (usa o último e-mail de cada pessoa). */
function lerRoda(caixa) {
  const roda = new Map();
  for (const m of caixa) {
    const quem = m.texto.match(/^Olá, (.+)!$/m)?.[1];
    const tirou = m.texto.match(/você tirou:\n\n {4}(.+)$/m)?.[1];
    if (quem && tirou) roda.set(quem, tirou);
  }
  return roda;
}

function conferirRodaUnica(roda, nomes) {
  assert.deepEqual([...roda.keys()].sort(), [...nomes].sort(), "todos receberam um e-mail");
  assert.equal(new Set(roda.values()).size, nomes.length, "ninguém foi tirado duas vezes");
  for (const [de, para] of roda) assert.notEqual(de, para, `${de} tirou a si mesmo`);
  const inicio = nomes[0];
  let atual = roda.get(inicio);
  let passos = 1;
  while (atual !== inicio) {
    atual = roda.get(atual);
    passos++;
    assert.ok(passos <= nomes.length, "a roda não fecha");
  }
  assert.equal(passos, nomes.length, "deve ser uma roda só");
}

async function esperarFuncao() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${API}/functions/v1/sorteio`, { method: "OPTIONS", headers: { apikey: PUB } });
      if (r.status < 500) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("A função não respondeu em 60 s. Ela está no ar? (npm run funcao:servir)");
}

// ---------------------------------------------------------------------------

const ponte = await iniciarPonteFalsa({ segredo: SEGREDO_PADRAO });
const sufixo = Date.now();
const emailDono = `dono-${sufixo}@exemplo.com`;
const emailOutro = `outro-${sufixo}@exemplo.com`;
const senha = "senha-de-teste-123";
const usuarios = [];

try {
  await esperarFuncao();
  ok("a função está no ar");

  let r;
  usuarios.push(await criarUsuario(emailDono, senha), await criarUsuario(emailOutro, senha));
  const dono = await entrar(emailDono, senha);
  const outro = await entrar(emailOutro, senha);
  ok("login dos dois organizadores de teste");

  // ninguém pode criar conta sozinho: senão qualquer um usaria o envio de e-mail do organizador
  r = await chamar("POST", "/auth/v1/signup", { corpo: { email: `intruso-${sufixo}@exemplo.com`, password: "senha-qualquer-123" } });
  assert.ok(r.status >= 400 && !r.dados?.access_token, `o cadastro aberto deixou criar conta: ${r.status} ${JSON.stringify(r.dados)}`);
  ok("ninguém consegue criar conta sozinho (cadastro desligado)");

  // ------------------------------------------------ evento e participantes (como o site faz)
  r = await rest("POST", "eventos", dono, {
    nome: "Natal do Teste",
    data_evento: "2026-12-20",
    valor: 50,
    recado: "Troca às 20h",
  });
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  const evento = r.dados[0];
  assert.equal(evento.dono_id, usuarios[0]);
  ok("o dono cria o evento");

  const nomes = ["Ana", "Bruno", "Carla", "Davi <i>&Co", "Elisa"];
  r = await rest("POST", "participantes", dono, [
    // (num insert em lote todos os objetos precisam ter as mesmas chaves)
    { evento_id: evento.id, nome: nomes[0], email: null },
    { evento_id: evento.id, nome: nomes[1], email: null },
    { evento_id: evento.id, nome: nomes[2], email: null },
    { evento_id: evento.id, nome: nomes[3], email: "davi@exemplo.com" },
    { evento_id: evento.id, nome: nomes[4], email: "elisa@falha.test" }, // a ponte falsa recusa este
  ]);
  assert.equal(r.status, 201, JSON.stringify(r.dados));
  const id = Object.fromEntries(r.dados.map((p) => [p.nome, p.id]));
  ok("o dono cadastra 5 participantes (um com e-mail que vai falhar)");

  // ------------------------------------------------ o link público (sem login)
  r = await rpc("evento_publico", { p_token: evento.token_publico });
  assert.equal(r.status, 200);
  assert.equal(r.dados.nome, "Natal do Teste");
  assert.equal(r.dados.participantes.length, 5);
  assert.ok(!JSON.stringify(r.dados).includes("@"), "a página pública não pode trazer e-mails");
  ok("quem tem o link vê o evento e os nomes, sem e-mails");

  r = await rpc("confirmar_email", { p_token: evento.token_publico, p_participante_id: id.Ana, p_email: "ANA@exemplo.com" });
  assert.deepEqual(r.dados, { ok: true, nome: "Ana" });
  r = await rpc("confirmar_email", { p_token: evento.token_publico, p_participante_id: id.Ana, p_email: "invasor@exemplo.com" });
  assert.equal(r.dados.erro, "ja_confirmado");
  r = await rpc("confirmar_email", { p_token: evento.token_publico, p_participante_id: id.Bruno, p_email: "bruno@exemplo.com" });
  assert.equal(r.dados.ok, true);
  ok("participantes confirmam o e-mail pelo link (e ninguém sobrescreve o de outro)");

  r = await chamar("GET", "/rest/v1/eventos?select=*");
  assert.ok([401, 403].includes(r.status), `anon lendo eventos: ${r.status}`);
  r = await chamar("GET", "/rest/v1/participantes?select=*");
  assert.ok([401, 403].includes(r.status), `anon lendo participantes: ${r.status}`);
  ok("sem login não dá para ler as tabelas");

  // ------------------------------------------------ segurança da função
  r = await chamar("POST", "/functions/v1/sorteio", { corpo: { acao: "diagnostico" } });
  assert.equal(r.status, 401, `sem token: ${r.status}`);
  r = await chamar("POST", "/functions/v1/sorteio", { token: PUB, corpo: { acao: "diagnostico" } });
  assert.equal(r.status, 401, `chave pública como token: ${r.status}`);
  r = await funcao(outro, { acao: "sortear", evento_id: evento.id });
  assert.equal(r.status, 404, `outro organizador sorteando o meu evento: ${r.status} ${JSON.stringify(r.dados)}`);
  r = await funcao(dono, { acao: "sortear" });
  assert.equal(r.status, 400);
  ok("a função recusa: sem login, chave pública como login, evento de outra pessoa, pedido torto");

  r = await funcao(dono, { acao: "diagnostico" });
  assert.deepEqual(r.dados, { ok: true, correio: true, usuario: emailDono, cota: 100, problema: null });
  r = await funcao(dono, { acao: "testar_email" });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  assert.equal(ponte.caixa.length, 1);
  assert.equal(ponte.caixa[0].para, emailDono);
  ok("diagnóstico e e-mail de teste chegam na ponte (com o 302 do Apps Script)");
  ponte.caixa.length = 0;

  // ------------------------------------------------ sortear: falta o e-mail da Carla
  r = await funcao(dono, { acao: "sortear", evento_id: evento.id });
  assert.equal(r.status, 400);
  assert.equal(r.dados.codigo, "email_faltando");
  assert.deepEqual(r.dados.faltando, ["Carla"]);
  assert.equal(ponte.caixa.length, 0);
  r = await rest("GET", `eventos?id=eq.${evento.id}&select=sorteado_em`, dono);
  assert.equal(r.dados[0].sorteado_em, null);
  ok("sem o e-mail de alguém não sorteia, não envia nada e avisa quem falta");

  r = await rpc("confirmar_email", { p_token: evento.token_publico, p_participante_id: id.Carla, p_email: "carla@exemplo.com" });
  assert.equal(r.dados.ok, true);

  // ------------------------------------------------ cota do Gmail: se não cobre todo mundo, o sorteio nem começa
  ponte.definirCota(3);
  r = await funcao(dono, { acao: "sortear", evento_id: evento.id });
  assert.equal(r.status, 409);
  assert.equal(r.dados.codigo, "cota_insuficiente");
  assert.equal(ponte.caixa.length, 0);
  r = await rest("GET", `eventos?id=eq.${evento.id}&select=sorteado_em,sorteio_numero`, dono);
  assert.deepEqual(r.dados[0], { sorteado_em: null, sorteio_numero: 0 });
  ponte.definirCota(100);
  ok("se a cota do Gmail não cobre todo mundo, o sorteio nem começa (ninguém fica com resultado velho)");

  // ------------------------------------------------ sortear de verdade
  r = await funcao(dono, { acao: "sortear", evento_id: evento.id });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  assert.equal(r.dados.numero, 1);
  assert.equal(r.dados.total, 5);
  assert.equal(r.dados.enviados, 4);
  assert.equal(r.dados.falhas.length, 1);
  assert.equal(r.dados.falhas[0].nome, "Elisa");
  assert.match(r.dados.falhas[0].erro, /Caixa de entrada cheia/);
  assert.ok(!JSON.stringify(r.dados).match(/"(de|para)"/), "a resposta não pode revelar os pares");
  assert.equal(ponte.caixa.length, 4);
  ok("sorteio feito: 4 e-mails entregues, a falha da Elisa volta para a tela e a resposta não revela pares");

  const primeiro = ponte.caixa.find((m) => m.para === "ana@exemplo.com");
  assert.ok(primeiro, "Ana recebeu (e-mail em minúsculo)");
  assert.match(primeiro.assunto, /Natal do Teste/);
  for (const trecho of ["domingo, 20 de dezembro de 2026", "R$ 50,00", "Troca às 20h"]) {
    assert.ok(primeiro.texto.includes(trecho) && primeiro.html.includes(trecho), `faltou "${trecho}" no e-mail`);
  }
  assert.equal(primeiro.nome, "Amigo Secreto (teste local)");
  const comNomeEstranho = ponte.caixa.find((m) => m.texto.includes("Davi <i>&Co") && !m.texto.startsWith("Olá, Davi"));
  assert.ok(comNomeEstranho, "alguém tirou o Davi");
  assert.ok(comNomeEstranho.html.includes("Davi &lt;i&gt;&amp;Co") && !comNomeEstranho.html.includes("<i>&Co"), "o HTML escapa o nome");
  ok("o conteúdo do e-mail está certo (data, valor, recado, remetente) e o HTML escapa nomes");

  r = await rest("GET", `participantes?evento_id=eq.${evento.id}&select=nome,email_enviado_em,erro_envio&order=nome`, dono);
  const porNome = Object.fromEntries(r.dados.map((p) => [p.nome, p]));
  for (const n of ["Ana", "Bruno", "Carla", "Davi <i>&Co"]) assert.ok(porNome[n].email_enviado_em, `${n} deveria estar como enviado`);
  assert.equal(porNome.Elisa.email_enviado_em, null);
  assert.match(porNome.Elisa.erro_envio, /Caixa de entrada cheia/);
  ok("o dono vê o status de cada envio na tabela (sem ver os pares)");

  // ------------------------------------------------ o dono não consegue espiar o sorteio
  r = await rpc("ler_sorteio", { p_evento_id: evento.id }, dono);
  assert.ok([401, 403, 404].includes(r.status), `ler_sorteio como dono: ${r.status}`);
  r = await chamar("GET", "/rest/v1/sorteios?select=*", { token: dono, cab: { "Accept-Profile": "private" } });
  assert.ok(r.status >= 400, `schema private como dono: ${r.status}`);
  r = await rest("GET", "sorteios?select=*", dono);
  assert.ok(r.status >= 400, `tabela sorteios em public: ${r.status}`);
  ok("nem o próprio organizador consegue ler quem tirou quem pela API");

  // ------------------------------------------------ depois do sorteio a lista fica travada
  r = await funcao(dono, { acao: "sortear", evento_id: evento.id });
  assert.equal(r.status, 409);
  assert.equal(r.dados.codigo, "sorteio_ja_realizado");

  // O dono NÃO pode trocar o e-mail de ninguém: senão desviaria o resultado dos outros com um "reenviar".
  for (const quem of [id.Elisa, id.Ana]) {
    r = await rest("PATCH", `participantes?id=eq.${quem}`, dono, { email: "desvio@exemplo.com" });
    assert.deepEqual(r.dados, [], "trocar e-mail depois do sorteio não pode alterar nada");
  }
  r = await rest("GET", `participantes?id=eq.${id.Ana}&select=email`, dono);
  assert.equal(r.dados[0].email, "ana@exemplo.com");
  ok("depois do sorteio o organizador não consegue trocar o e-mail de ninguém (nem desviar um resultado)");

  r = await funcao(dono, { acao: "reenviar", evento_id: evento.id });
  assert.equal(r.status, 200);
  assert.equal(r.dados.total, 1);
  assert.equal(r.dados.enviados, 0);
  assert.equal(r.dados.falhas[0].nome, "Elisa");
  ok('"Reenviar" manda sempre para o endereço guardado (o da Elisa continua falhando)');

  // ------------------------------------------------ cancelar o sorteio: o único caminho para corrigir algo
  r = await rpc("reabrir_sorteio", { p_evento_id: evento.id }, outro);
  assert.ok(r.status >= 400, `outro organizador cancelando o meu sorteio: ${r.status}`);
  r = await rpc("reabrir_sorteio", { p_evento_id: evento.id });
  assert.ok(r.status >= 400, `anônimo cancelando sorteio: ${r.status}`);
  r = await rpc("reabrir_sorteio", { p_evento_id: evento.id }, dono);
  assert.ok(r.status === 200 || r.status === 204, `reabrir: ${r.status} ${JSON.stringify(r.dados)}`);
  r = await rest("GET", `eventos?id=eq.${evento.id}&select=sorteado_em,sorteio_numero`, dono);
  assert.deepEqual(r.dados[0], { sorteado_em: null, sorteio_numero: 1 });
  ok("cancelar o sorteio: só o dono consegue, e a lista é liberada");

  r = await rest("PATCH", `participantes?id=eq.${id.Elisa}`, dono, { email: "Elisa@Exemplo.com" });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  assert.equal(r.dados[0].email, "elisa@exemplo.com");
  ponte.caixa.length = 0;
  r = await funcao(dono, { acao: "sortear", evento_id: evento.id });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  assert.equal(r.dados.numero, 2);
  assert.equal(r.dados.enviados, 5);
  assert.equal(ponte.caixa.length, 5);
  for (const m of ponte.caixa) {
    assert.match(m.assunto, /NOVO sorteio \(nº 2\)/);
    assert.match(m.texto, /NÃO vale mais/);
  }
  conferirRodaUnica(lerRoda(ponte.caixa), nomes);
  ok("depois de cancelar e corrigir o e-mail, o sorteio nº 2 chega para os 5, numa roda única, mandando ignorar o anterior");
  // ------------------------------------------------ depois do sorteio a lista trava
  r = await rest("POST", "participantes", dono, { evento_id: evento.id, nome: "Atrasado" });
  assert.ok(r.status >= 400, `inserir depois do sorteio: ${r.status}`);
  r = await rest("DELETE", `participantes?id=eq.${id.Ana}`, dono);
  assert.deepEqual(r.dados, [], "apagar depois do sorteio não pode apagar nada");
  r = await rpc("confirmar_email", { p_token: evento.token_publico, p_participante_id: id.Ana, p_email: "x@exemplo.com" });
  assert.equal(r.dados.erro, "sorteio_ja_realizado");
  ok("depois do sorteio ninguém entra, sai ou troca e-mail pelo link");

  // ------------------------------------------------ reenviar para uma pessoa só
  const antes = ponte.caixa.length;
  r = await funcao(dono, { acao: "reenviar", evento_id: evento.id, participante_id: id.Ana });
  assert.equal(r.dados.enviados, 1);
  const ultimaDaAna = [...ponte.caixa].reverse().find((m) => m.para === "ana@exemplo.com");
  const primeiraDaAna = ponte.caixa.find((m) => m.para === "ana@exemplo.com");
  assert.equal(ponte.caixa.length, antes + 1);
  assert.equal(ultimaDaAna.texto, primeiraDaAna.texto, "o reenvio repete o mesmo sorteado");
  ok("reenviar para uma pessoa repete exatamente o mesmo sorteado");

  // ------------------------------------------------ CORS (o navegador do GitHub Pages chama a função)
  r = await chamar("OPTIONS", "/functions/v1/sorteio", {
    cab: {
      Origin: "https://fulano.github.io",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, apikey, content-type, x-client-info",
    },
  });
  assert.ok(r.status >= 200 && r.status < 300, `preflight: ${r.status}`);
  assert.ok(r.headers.get("access-control-allow-origin"), "faltou Access-Control-Allow-Origin");
  assert.match(r.headers.get("access-control-allow-headers") ?? "", /authorization/i);
  // (a resposta de verdade também precisa trazer o cabeçalho, senão o navegador a descarta)
  r = await funcao(dono, { acao: "diagnostico" });
  assert.equal(r.status, 200);
  assert.ok(r.headers.get("access-control-allow-origin"), "faltou Access-Control-Allow-Origin na resposta do POST");
  ok("o CORS libera o site do GitHub Pages (pré-voo e resposta)");

  console.log(`\n${passaram} verificações de ponta a ponta passaram.`);
} catch (erro) {
  console.error(`\nFALHOU: ${erro.message ?? erro}`);
  process.exitCode = 1;
} finally {
  // limpeza: apaga os usuários de teste (e, em cascata, os eventos deles)
  for (const uid of usuarios) {
    await chamar("DELETE", `/auth/v1/admin/users/${uid}`, { chave: ADMIN, token: ADMIN }).catch(() => {});
  }
  await ponte.fechar();
}
