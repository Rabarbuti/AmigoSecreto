import { test } from "node:test";
import assert from "node:assert/strict";
import { inteiroAleatorio, sortearRoda } from "../supabase/functions/sorteio/sorteio.ts";

const ids = (n) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

/** Segue a corrente a partir do primeiro e conta quantos passos até voltar. */
function tamanhoDaRoda(pares) {
  const proximo = new Map(pares.map((p) => [p.de, p.para]));
  const inicio = pares[0].de;
  let atual = proximo.get(inicio);
  let passos = 1;
  while (atual !== inicio) {
    atual = proximo.get(atual);
    passos++;
    if (passos > pares.length + 1) return Infinity;
  }
  return passos;
}

test("roda: ninguém tira a si mesmo, todos tiram e são tirados uma vez, roda única", () => {
  for (let n = 3; n <= 14; n++) {
    for (let rodada = 0; rodada < 300; rodada++) {
      const pares = sortearRoda(ids(n));
      assert.equal(pares.length, n);
      assert.equal(new Set(pares.map((p) => p.de)).size, n);
      assert.equal(new Set(pares.map((p) => p.para)).size, n);
      for (const p of pares) assert.notEqual(p.de, p.para);
      assert.equal(tamanhoDaRoda(pares), n, "deve ser uma roda só (sem trocas diretas nem rodinhas)");
    }
  }
});

test("roda: com 3 ou mais pessoas nunca existe troca direta (A tira B e B tira A)", () => {
  for (let rodada = 0; rodada < 500; rodada++) {
    const pares = sortearRoda(ids(5));
    const alvo = new Map(pares.map((p) => [p.de, p.para]));
    for (const [de, para] of alvo) assert.notEqual(alvo.get(para), de);
  }
});

test("roda: não mexe na lista recebida", () => {
  const original = ids(6);
  const copia = [...original];
  sortearRoda(original);
  assert.deepEqual(original, copia);
});

test("roda: menos de 3 pessoas ou ids repetidos são recusados", () => {
  assert.throws(() => sortearRoda([]), /pelo menos 3/);
  assert.throws(() => sortearRoda(["a", "b"]), /pelo menos 3/);
  assert.throws(() => sortearRoda(["a", "b", "a"]), /repetidos/);
});

test("roda: com gerador fixo o resultado é previsível (usa o gerador injetado)", () => {
  // inteiro(n) = 0 sempre: Fisher–Yates troca cada posição i com a 0
  const pares = sortearRoda(["a", "b", "c", "d"], () => 0);
  assert.equal(tamanhoDaRoda(pares), 4);
  assert.deepEqual(pares, sortearRoda(["a", "b", "c", "d"], () => 0));
});

test("roda: todas as 6 rodas possíveis com 4 pessoas saem com chance parecida", () => {
  const contagem = new Map();
  const total = 30000;
  for (let i = 0; i < total; i++) {
    const chave = sortearRoda(ids(4)).map((p) => `${p.de}>${p.para}`).sort().join(",");
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
  }
  assert.equal(contagem.size, 6, "com 4 pessoas existem exatamente (4-1)! = 6 rodas");
  const esperado = total / 6;
  const qui2 = [...contagem.values()].reduce((s, o) => s + (o - esperado) ** 2 / esperado, 0);
  // 5 graus de liberdade: 20,5 é o limite para p = 0,001
  assert.ok(qui2 < 20.5, `distribuição torta (qui² = ${qui2.toFixed(2)})`);
});

test("inteiroAleatorio: faixa correta e sem viés visível", () => {
  const n = 6;
  const contagem = new Array(n).fill(0);
  const total = 60000;
  for (let i = 0; i < total; i++) {
    const x = inteiroAleatorio(n);
    assert.ok(Number.isInteger(x) && x >= 0 && x < n);
    contagem[x]++;
  }
  const esperado = total / n;
  const qui2 = contagem.reduce((s, o) => s + (o - esperado) ** 2 / esperado, 0);
  assert.ok(qui2 < 20.5, `viés suspeito (qui² = ${qui2.toFixed(2)})`);
  assert.throws(() => inteiroAleatorio(0), RangeError);
  assert.throws(() => inteiroAleatorio(1.5), RangeError);
  assert.equal(inteiroAleatorio(1), 0);
});
