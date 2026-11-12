import { test } from "node:test";
import assert from "node:assert/strict";
import { executar, executarComLimite, textoDoErro } from "../supabase/functions/sorteio/nucleo.ts";

const DONO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OUTRO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EV = "11111111-1111-4111-8111-111111111111";
const EV2 = "22222222-2222-4222-8222-222222222222";
const pid = (n) => `00000000-0000-4000-8000-00000000000${n}`;

const usuario = { id: DONO, email: "organizador@exemplo.com" };

function participantes(qtd = 4) {
  const nomes = ["Ana", "Bruno", "Carla", "Davi", "Elisa"];
  return Array.from({ length: qtd }, (_, i) => ({
    id: pid(i + 1),
    evento_id: EV,
    nome: nomes[i],
    email: `${nomes[i].toLowerCase()}@exemplo.com`,
    email_enviado_em: null,
    erro_envio: null,
  }));
}

function criarBancoFalso({ lista = participantes(), sorteadoEm = null, donoId = DONO, numero = 0 } = {}) {
  const estado = {
    evento: {
      id: EV, dono_id: donoId, nome: "Natal", data_evento: "2026-12-20", valor: 50, recado: null,
      sorteado_em: sorteadoEm, sorteio_numero: numero,
    },
    participantes: lista.map((p) => ({ ...p })),
    pares: [],
    gravacoes: 0,
  };
  const banco = {
    async buscarEvento(id) {
      return id === estado.evento.id ? { ...estado.evento } : null;
    },
    async listarParticipantes(eventoId) {
      return estado.participantes.filter((p) => p.evento_id === eventoId).map((p) => ({ ...p }));
    },
    // igual ao banco de verdade: só grava se ainda não há sorteio, e devolve o número dele
    async gravarSorteio(_eventoId, pares) {
      if (estado.evento.sorteado_em) throw { message: "sorteio_ja_realizado" };
      estado.pares = pares.map((p) => ({ ...p }));
      estado.gravacoes++;
      estado.evento.sorteado_em = "2026-11-12T10:00:00Z";
      estado.evento.sorteio_numero += 1;
      for (const p of estado.participantes) {
        p.email_enviado_em = null;
        p.erro_envio = null;
      }
      return estado.evento.sorteio_numero;
    },
    async lerSorteio() {
      return estado.pares.map((p) => ({ ...p }));
    },
    async marcarEnvio(id, erro) {
      const p = estado.participantes.find((x) => x.id === id);
      p.email_enviado_em = erro ? null : "agora";
      p.erro_envio = erro;
    },
  };
  return { banco, estado };
}

function criarCorreioFalso({ falharPara = [], erro = "caixa cheia", cota = undefined } = {}) {
  const enviados = [];
  const correio = {
    enviados,
    falharPara: new Set(falharPara),
    aoEnviar: null, // gancho dos testes: roda depois de cada envio com sucesso
    async enviar(m) {
      if (this.falharPara.has(m.para)) throw new Error(erro);
      enviados.push(m);
      await this.aoEnviar?.(m);
    },
  };
  if (cota !== undefined) {
    correio.cota = async () => {
      if (cota instanceof Error) throw cota;
      return cota;
    };
  }
  return correio;
}

// roda fixa: 1 -> 2 -> 3 -> 4 -> 1
const RODA = (ids) => ids.map((id, i) => ({ de: id, para: ids[(i + 1) % ids.length] }));

function montar(opcoes = {}) {
  const { banco, estado } = criarBancoFalso(opcoes);
  const correio = opcoes.semCorreio ? null : criarCorreioFalso(opcoes.correio);
  return { banco, estado, correio, dep: { banco, correio, sortear: RODA, ...opcoes.extra } };
}

const sortear = (dep, u = usuario) => executar({ acao: "sortear", evento_id: EV }, u, dep);

test("sortear: grava o sorteio e manda um e-mail para cada pessoa com o nome certo", async () => {
  const { dep, estado, correio } = montar();
  const r = await sortear(dep);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.corpo).sort(), ["enviados", "falhas", "numero", "ok", "total"].sort());
  assert.equal(r.corpo.enviados, 4);
  assert.equal(r.corpo.total, 4);
  assert.equal(r.corpo.numero, 1);
  assert.deepEqual(r.corpo.falhas, []);
  assert.equal(estado.gravacoes, 1);
  assert.ok(estado.evento.sorteado_em);

  assert.equal(correio.enviados.length, 4);
  const nomeDe = new Map(estado.participantes.map((p) => [p.email, p.nome]));
  const esperado = { Ana: "Bruno", Bruno: "Carla", Carla: "Davi", Davi: "Ana" };
  for (const m of correio.enviados) {
    const dest = nomeDe.get(m.para);
    assert.ok(m.texto.includes(`Olá, ${dest}!`));
    assert.ok(m.texto.includes(esperado[dest]), `${dest} deveria ter tirado ${esperado[dest]}`);
    assert.ok(!m.texto.includes("ATENÇÃO"), "no primeiro sorteio não há aviso de sorteio refeito");
    assert.ok(!m.assunto.includes("NOVO"));
  }
  assert.ok(estado.participantes.every((p) => p.email_enviado_em === "agora" && p.erro_envio === null));
});

test("sortear: a resposta não revela quem tirou quem", async () => {
  const { dep, estado } = montar();
  const r = await sortear(dep);
  const texto = JSON.stringify(r);
  for (const p of estado.participantes) assert.ok(!texto.includes(p.id), "a resposta não deveria citar ids");
  assert.ok(!texto.includes('"de"') && !texto.includes('"para"'));
});

test("sortear: usa o sorteio de verdade quando nada é injetado", async () => {
  const { banco, estado, correio } = montar();
  const r = await sortear({ banco, correio });
  assert.equal(r.status, 200);
  const ids = estado.participantes.map((p) => p.id);
  assert.equal(estado.pares.length, ids.length);
  for (const par of estado.pares) assert.notEqual(par.de, par.para);
  assert.equal(new Set(estado.pares.map((p) => p.para)).size, ids.length);
});

test("sortear: evento de outra pessoa ou inexistente dá 404 e não grava nada", async () => {
  const alheio = montar({ donoId: OUTRO });
  const r1 = await sortear(alheio.dep);
  assert.equal(r1.status, 404);
  assert.equal(alheio.estado.gravacoes, 0);
  assert.equal(alheio.correio.enviados.length, 0);

  const { dep } = montar();
  const r2 = await executar({ acao: "sortear", evento_id: EV2 }, usuario, dep);
  assert.equal(r2.status, 404);
  assert.deepEqual(r1.corpo, r2.corpo, "mesma resposta para 'não existe' e 'é de outro'");
});

test("sortear: menos de 3 participantes é recusado", async () => {
  const { dep, estado } = montar({ lista: participantes(2) });
  const r = await sortear(dep);
  assert.equal(r.status, 400);
  assert.equal(r.corpo.codigo, "participantes_insuficientes");
  assert.equal(estado.gravacoes, 0);
});

test("sortear: quem está sem e-mail é listado e nada é gravado nem enviado", async () => {
  const lista = participantes(4);
  lista[1].email = null;
  lista[3].email = null;
  const { dep, estado, correio } = montar({ lista });
  const r = await sortear(dep);
  assert.equal(r.status, 400);
  assert.equal(r.corpo.codigo, "email_faltando");
  assert.deepEqual(r.corpo.faltando, ["Bruno", "Davi"]);
  assert.match(r.corpo.erro, /Bruno, Davi/);
  assert.equal(estado.gravacoes, 0);
  assert.equal(correio.enviados.length, 0);
});

test("sortear: sem o correio configurado dá 503 e NÃO grava o sorteio", async () => {
  const { dep, estado } = montar({ semCorreio: true });
  const r = await sortear(dep);
  assert.equal(r.status, 503);
  assert.equal(r.corpo.codigo, "correio_nao_configurado");
  assert.match(r.corpo.erro, /APPS_SCRIPT_URL/);
  assert.equal(estado.gravacoes, 0);
  assert.equal(estado.evento.sorteado_em, null);
});

test("sortear: correio mal configurado mostra o problema na mensagem", async () => {
  const { dep } = montar({ semCorreio: true, extra: { problemaDoCorreio: "o APPS_SCRIPT_URL precisa começar com https://" } });
  const r = await sortear(dep);
  assert.equal(r.status, 503);
  assert.match(r.corpo.erro, /mal configurado.*https:\/\//);
});

test("sortear: já sorteado dá 409 e manda usar 'Refazer o sorteio' (que cancela e libera a lista)", async () => {
  const { dep, estado, correio } = montar({ sorteadoEm: "2026-11-01T00:00:00Z", numero: 1 });
  const r = await sortear(dep);
  assert.equal(r.status, 409);
  assert.equal(r.corpo.codigo, "sorteio_ja_realizado");
  assert.match(r.corpo.erro, /Refazer o sorteio/);
  assert.equal(estado.gravacoes, 0);
  assert.equal(correio.enviados.length, 0);
});

test("sortear depois de cancelar o sorteio: vira o nº 2 e os e-mails mandam ignorar o anterior", async () => {
  // estado depois de reabrir_sorteio: sem sorteio ativo, mas o evento já teve 1
  const { dep, estado, correio } = montar({ sorteadoEm: null, numero: 1 });
  const r = await sortear(dep);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.numero, 2);
  assert.equal(estado.evento.sorteio_numero, 2);
  assert.equal(correio.enviados.length, 4);
  for (const m of correio.enviados) {
    assert.match(m.assunto, /NOVO sorteio \(nº 2\)/);
    assert.match(m.texto, /sorteio nº 2.*NÃO vale mais/s);
    assert.ok(m.html.includes("sorteio nº 2"));
  }
});

test("sortear: dois pedidos ao mesmo tempo: só um sorteia (o banco trava o segundo)", async () => {
  const { dep, estado, correio } = montar();
  const [a, b] = await Promise.all([sortear(dep), sortear(dep)]);
  const status = [a.status, b.status].sort();
  assert.deepEqual(status, [200, 409]);
  assert.equal(estado.gravacoes, 1);
  assert.equal(correio.enviados.length, 4, "só o sorteio vencedor manda e-mails");
});

test("sortear: se o e-mail de alguém falha, os outros saem e a falha fica registrada", async () => {
  const { dep, estado, correio } = montar({ correio: { falharPara: ["carla@exemplo.com"], erro: "caixa cheia" } });
  const r = await sortear(dep);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.enviados, 3);
  assert.deepEqual(r.corpo.falhas, [{ participante_id: pid(3), nome: "Carla", erro: "caixa cheia" }]);
  assert.equal(correio.enviados.length, 3);
  const carla = estado.participantes.find((p) => p.nome === "Carla");
  assert.equal(carla.email_enviado_em, null);
  assert.equal(carla.erro_envio, "caixa cheia");
  assert.equal(estado.evento.sorteado_em !== null, true, "o sorteio fica valendo, só o envio falhou");
});

test("cota do Gmail: se não cobre todo mundo, nem sorteia (ninguém fica com resultado antigo)", async () => {
  const { dep, estado, correio } = montar({ correio: { cota: 3 } });
  const r = await sortear(dep);
  assert.equal(r.status, 409);
  assert.equal(r.corpo.codigo, "cota_insuficiente");
  assert.equal(r.corpo.cota, 3);
  assert.equal(r.corpo.precisa, 4);
  assert.match(r.corpo.erro, /mais 3 e-mails.*precisa de 4/);
  assert.equal(estado.gravacoes, 0);
  assert.equal(correio.enviados.length, 0);

  const um = montar({ correio: { cota: 1 } });
  assert.match((await sortear(um.dep)).corpo.erro, /mais 1 e-mail hoje/);
});

test("cota do Gmail: cota exata passa; cota desconhecida ou com erro não bloqueia", async () => {
  for (const cota of [4, 100, null, new Error("ponte fora do ar")]) {
    const { dep, estado } = montar({ correio: { cota } });
    const r = await sortear(dep);
    assert.equal(r.status, 200, `cota=${cota}`);
    assert.equal(estado.gravacoes, 1);
  }
  // correio sem o método cota (ponte antiga): também não bloqueia
  const sem = montar();
  assert.equal(sem.correio.cota, undefined);
  assert.equal((await sortear(sem.dep)).status, 200);
});

test("envio interrompido: se o sorteio é cancelado enquanto os e-mails saem, para de mandar os antigos", async () => {
  const { dep, estado, correio } = montar({ extra: { simultaneos: 1 } });
  // depois do primeiro e-mail, alguém cancela o sorteio (reabrir_sorteio)
  correio.aoEnviar = async () => {
    estado.evento.sorteado_em = null;
  };
  const r = await sortear(dep);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.interrompido, true);
  assert.equal(r.corpo.enviados, 1);
  assert.equal(correio.enviados.length, 1, "os e-mails seguintes, com pares já cancelados, não saem");
  assert.deepEqual(r.corpo.falhas, []);
});

test("envio interrompido: se vira outro sorteio (nº diferente) no meio, também para", async () => {
  const { dep, estado, correio } = montar({ extra: { simultaneos: 1 } });
  correio.aoEnviar = async () => {
    estado.evento.sorteio_numero += 1; // outro sorteio já foi gravado
  };
  const r = await sortear(dep);
  assert.equal(r.corpo.interrompido, true);
  assert.equal(correio.enviados.length, 1);
});

test("reenviar (sem participante): manda só para quem ainda não recebeu, com o mesmo sorteado", async () => {
  const { dep, estado, correio } = montar({ correio: { falharPara: ["carla@exemplo.com"] } });
  await sortear(dep);
  correio.falharPara.clear();
  correio.enviados.length = 0;

  const r = await executar({ acao: "reenviar", evento_id: EV }, usuario, dep);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.total, 1);
  assert.equal(r.corpo.enviados, 1);
  assert.equal(r.corpo.numero, 1);
  assert.equal(correio.enviados.length, 1);
  assert.equal(correio.enviados[0].para, "carla@exemplo.com");
  assert.ok(correio.enviados[0].texto.includes("Davi"), "Carla tirou Davi no sorteio original");
  assert.equal(estado.gravacoes, 1, "reenviar não sorteia de novo");
  assert.equal(estado.participantes.find((p) => p.nome === "Carla").erro_envio, null);
});

test("reenviar (um participante): reenvia mesmo quem já recebeu, sempre para o e-mail guardado", async () => {
  const { dep, correio } = montar();
  await sortear(dep);
  correio.enviados.length = 0;
  const r = await executar({ acao: "reenviar", evento_id: EV, participante_id: pid(2) }, usuario, dep);
  assert.equal(r.status, 200);
  assert.equal(correio.enviados.length, 1);
  assert.equal(correio.enviados[0].para, "bruno@exemplo.com");
  assert.ok(correio.enviados[0].texto.includes("Carla"));
});

test("reenviar de um sorteio refeito leva o aviso do nº certo", async () => {
  const { dep, correio } = montar({ numero: 2 });
  await sortear(dep); // vira o nº 3
  correio.enviados.length = 0;
  await executar({ acao: "reenviar", evento_id: EV, participante_id: pid(1) }, usuario, dep);
  assert.match(correio.enviados[0].assunto, /nº 3/);
});

test("reenviar: sem pendentes não manda nada; antes do sorteio dá 409; participante errado dá 404", async () => {
  const feito = montar();
  await sortear(feito.dep);
  feito.correio.enviados.length = 0;
  const r1 = await executar({ acao: "reenviar", evento_id: EV }, usuario, feito.dep);
  assert.equal(r1.status, 200);
  assert.equal(r1.corpo.total, 0);
  assert.equal(feito.correio.enviados.length, 0);

  const antes = montar();
  const r2 = await executar({ acao: "reenviar", evento_id: EV }, usuario, antes.dep);
  assert.equal(r2.status, 409);
  assert.equal(r2.corpo.codigo, "sem_sorteio");

  const r3 = await executar({ acao: "reenviar", evento_id: EV, participante_id: pid(9) }, usuario, feito.dep);
  assert.equal(r3.status, 404);
});

test("reenviar: só o dono do evento consegue", async () => {
  const { dep } = montar({ donoId: OUTRO, sorteadoEm: "2026-11-01T00:00:00Z", numero: 1 });
  const r = await executar({ acao: "reenviar", evento_id: EV }, usuario, dep);
  assert.equal(r.status, 404);
});

test("testar_email: manda para o próprio organizador", async () => {
  const { dep, correio } = montar();
  const r = await executar({ acao: "testar_email" }, usuario, dep);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.enviado_para, "organizador@exemplo.com");
  assert.equal(correio.enviados.length, 1);
  assert.equal(correio.enviados[0].para, "organizador@exemplo.com");
});

test("testar_email: sem correio 503, falha no envio 502, usuário sem e-mail 400", async () => {
  const sem = montar({ semCorreio: true });
  assert.equal((await executar({ acao: "testar_email" }, usuario, sem.dep)).status, 503);

  const falha = montar({ correio: { falharPara: ["organizador@exemplo.com"], erro: "sem cota" } });
  const r = await executar({ acao: "testar_email" }, usuario, falha.dep);
  assert.equal(r.status, 502);
  assert.equal(r.corpo.erro, "sem cota");

  const { dep } = montar();
  assert.equal((await executar({ acao: "testar_email" }, { id: DONO, email: null }, dep)).status, 400);
});

test("diagnostico: diz se o e-mail está configurado, a cota e o problema", async () => {
  const com = await executar({ acao: "diagnostico" }, usuario, montar().dep);
  assert.deepEqual(com, { status: 200, corpo: { ok: true, correio: true, usuario: "organizador@exemplo.com", cota: null, problema: null } });

  const comCota = await executar({ acao: "diagnostico" }, usuario, montar({ correio: { cota: 87 } }).dep);
  assert.equal(comCota.corpo.cota, 87);

  const sem = await executar({ acao: "diagnostico" }, usuario, montar({ semCorreio: true }).dep);
  assert.equal(sem.corpo.correio, false);
  assert.equal(sem.corpo.problema, null);

  const ruim = await executar({ acao: "diagnostico" }, usuario, montar({ semCorreio: true, extra: { problemaDoCorreio: "url ruim" } }).dep);
  assert.equal(ruim.corpo.problema, "url ruim");
});

test("quem pode usar: contas anônimas nunca; e, se houver lista, só os e-mails dela", async () => {
  const { dep, estado, correio } = montar();
  const anonimo = await sortear(dep, { id: DONO, email: "organizador@exemplo.com", anonimo: true });
  assert.equal(anonimo.status, 403);
  assert.equal(estado.gravacoes, 0);
  assert.equal(correio.enviados.length, 0);

  const restrito = montar({ extra: { organizadoresPermitidos: ["outra.pessoa@exemplo.com"] } });
  const r = await sortear(restrito.dep);
  assert.equal(r.status, 403);
  assert.equal(r.corpo.codigo, "sem_permissao");
  assert.equal(restrito.estado.gravacoes, 0);
  for (const acao of ["diagnostico", "testar_email"]) {
    assert.equal((await executar({ acao }, usuario, restrito.dep)).status, 403, acao);
  }
  assert.equal((await sortear(restrito.dep, { id: DONO, email: null })).status, 403);

  const liberado = montar({ extra: { organizadoresPermitidos: ["amiga@exemplo.com", "organizador@exemplo.com"] } });
  assert.equal((await sortear(liberado.dep, { id: DONO, email: "Organizador@Exemplo.com" })).status, 200);
});

test("pedidos malformados dão 400", async () => {
  const { dep } = montar();
  for (const ruim of [null, undefined, "sortear", 42, [], {}, { acao: "apagar" }, { acao: "sortear" },
    { acao: "sortear", evento_id: "123" }, { acao: "reenviar", evento_id: EV, participante_id: "x" }]) {
    const r = await executar(ruim, usuario, dep);
    assert.equal(r.status, 400, `deveria recusar ${JSON.stringify(ruim)}`);
  }
});

test("o pedido não aceita mais 'refazer': sortear com refazer:true se comporta como sortear normal", async () => {
  const { dep, estado } = montar({ sorteadoEm: "2026-11-01T00:00:00Z", numero: 1 });
  const r = await executar({ acao: "sortear", evento_id: EV, refazer: true }, usuario, dep);
  assert.equal(r.status, 409);
  assert.equal(estado.gravacoes, 0);
});

test("erro do banco ao gravar: 500 genérico, nada é enviado", async () => {
  const { dep, banco, correio } = montar();
  banco.gravarSorteio = async () => {
    throw { message: "pares_invalidos", code: "P0001" };
  };
  const original = console.error;
  console.error = () => {}; // o erro é esperado: não polui a saída do teste
  let r;
  try {
    r = await sortear(dep);
  } finally {
    console.error = original;
  }
  assert.equal(r.status, 500);
  assert.match(r.corpo.erro, /Nada foi enviado/);
  assert.equal(correio.enviados.length, 0);
});

test("corrida: se outro pedido sorteou no meio, o banco responde e vira 409", async () => {
  const { dep, banco } = montar();
  banco.gravarSorteio = async () => {
    throw { message: "sorteio_ja_realizado" };
  };
  const r = await sortear(dep);
  assert.equal(r.status, 409);
});

test("erro inesperado: 500 genérico e o log não vaza nomes nem e-mails", async () => {
  const { dep, banco } = montar();
  banco.listarParticipantes = async () => {
    throw new Error("falha interna");
  };
  const registro = [];
  const original = console.error;
  console.error = (...args) => registro.push(args.join(" "));
  try {
    const r = await sortear(dep);
    assert.equal(r.status, 500);
    assert.ok(!r.corpo.erro.includes("falha interna"), "não expõe detalhes internos");
  } finally {
    console.error = original;
  }
  assert.equal(registro.length, 1);
  assert.ok(!/@exemplo|Ana|Bruno/.test(registro[0]));
});

test("executarComLimite nunca passa do limite de tarefas ao mesmo tempo", async () => {
  let ativas = 0;
  let maximo = 0;
  const feitos = [];
  await executarComLimite([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
    ativas++;
    maximo = Math.max(maximo, ativas);
    await new Promise((r) => setTimeout(r, 5));
    feitos.push(n);
    ativas--;
  });
  assert.equal(maximo, 3);
  assert.deepEqual(feitos.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  await executarComLimite([], 3, async () => assert.fail("não deveria rodar"));
});

test("textoDoErro entende Error, objetos do supabase-js e textos", () => {
  assert.equal(textoDoErro(new Error("a  b\nc")), "a b c");
  assert.equal(textoDoErro({ message: "falhou", code: "X" }), "falhou");
  assert.equal(textoDoErro("texto"), "texto");
  assert.equal(textoDoErro("x".repeat(500)).length, 300);
});
