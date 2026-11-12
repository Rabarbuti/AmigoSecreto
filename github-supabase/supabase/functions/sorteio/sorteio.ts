// Sorteio em "roda única", como na primeira versão do site (Google Apps Script):
// embaralha todo mundo e cada pessoa tira a seguinte da roda.
//
// Garantias:
//  - ninguém tira a si mesmo;
//  - todo mundo tira alguém e é tirado por alguém (uma vez cada);
//  - não existe "troca direta" (A tira B e B tira A) com 3 ou mais pessoas.
// Todas as rodas possíveis têm a mesma chance de sair.

import type { Par } from "./tipos.ts";

/** Inteiro uniforme em [0, n), sem viés de módulo, usando o gerador seguro do sistema. */
export function inteiroAleatorio(n: number): number {
  if (!Number.isInteger(n) || n <= 0 || n > 2 ** 32) {
    throw new RangeError("n precisa ser um inteiro entre 1 e 2^32");
  }
  const limite = Math.floor(2 ** 32 / n) * n; // maior múltiplo de n que cabe em 32 bits
  const buffer = new Uint32Array(1);
  let x: number;
  do {
    crypto.getRandomValues(buffer);
    x = buffer[0];
  } while (x >= limite);
  return x % n;
}

/**
 * @param ids ids dos participantes (sem repetição, no mínimo 3)
 * @param inteiro gerador de inteiros em [0, n) — só é trocado nos testes
 */
export function sortearRoda(
  ids: readonly string[],
  inteiro: (n: number) => number = inteiroAleatorio,
): Par[] {
  if (new Set(ids).size !== ids.length) throw new Error("Há participantes repetidos.");
  if (ids.length < 3) throw new Error("É preciso ter pelo menos 3 participantes.");

  const ordem = [...ids];
  for (let i = ordem.length - 1; i > 0; i--) {
    const j = inteiro(i + 1); // Fisher–Yates
    [ordem[i], ordem[j]] = [ordem[j], ordem[i]];
  }
  return ordem.map((id, k) => ({ de: id, para: ordem[(k + 1) % ordem.length] }));
}
