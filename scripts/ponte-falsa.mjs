// "Ponte de e-mail" FALSA, só para testar no seu computador sem gastar e-mails do Gmail.
// Imita o Apps Script de verdade (apps-script/Code.gs), inclusive o redirecionamento 302
// que o Google faz depois do POST, e guarda os e-mails numa "caixa" em memória.
//
//   npm run ponte-falsa          liga na porta 8787 (use APPS_SCRIPT_URL=http://host.docker.internal:8787/exec)
//   GET    /caixa                lista os e-mails recebidos (JSON)
//   DELETE /caixa                esvazia a caixa
//   E-mail para um endereço @falha.test é recusado, para testar o caminho de erro.

import http from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const SEGREDO_PADRAO = "segredo-local-de-teste-com-mais-de-vinte-caracteres";

export function iniciarPonteFalsa({ porta = 8787, segredo = SEGREDO_PADRAO, host = "127.0.0.1", cota = 100 } = {}) {
  const caixa = [];
  const respostas = new Map();
  let cotaDoDia = cota; // quantos e-mails "o Gmail" deixa mandar hoje (diminui a cada envio)

  const lerCorpo = (req) =>
    new Promise((resolve) => {
      let texto = "";
      req.setEncoding("utf8");
      req.on("data", (pedaco) => (texto += pedaco));
      req.on("end", () => resolve(texto));
    });

  const json = (res, status, objeto) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(objeto));
  };

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/exec") {
      let resultado;
      try {
        const d = JSON.parse((await lerCorpo(req)) || "{}");
        if (d.segredo !== segredo) resultado = { ok: false, erro: "Segredo incorreto: confira APPS_SCRIPT_SEGREDO no Supabase." };
        else if (d.acao === "cota") resultado = { ok: true, cota_restante: cotaDoDia };
        else if (typeof d.para !== "string" || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(d.para)) {
          resultado = { ok: false, erro: "Endereço de e-mail inválido." };
        } else if (d.para.endsWith("@falha.test")) resultado = { ok: false, erro: "Caixa de entrada cheia (falha simulada)." };
        else if (cotaDoDia <= 0) resultado = { ok: false, erro: "Service invoked too many times for one day: email." };
        else {
          caixa.push({ para: d.para, assunto: d.assunto, texto: d.texto, html: d.html, nome: d.nome, em: new Date().toISOString() });
          cotaDoDia--;
          resultado = { ok: true, cota_restante: cotaDoDia };
        }
      } catch (e) {
        resultado = { ok: false, erro: String(e.message || e) };
      }
      // Como o Google: o POST responde 302 e o resultado fica noutro endereço.
      const id = randomUUID();
      respostas.set(id, resultado);
      res.writeHead(302, { Location: `http://${req.headers.host}/echo?r=${id}` });
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/echo") {
      const r = respostas.get(url.searchParams.get("r"));
      return r ? json(res, 200, r) : json(res, 404, { ok: false, erro: "resposta expirada" });
    }
    if (req.method === "GET" && url.pathname === "/exec") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Ponte de e-mail do Amigo Secreto (FALSA, local): no ar.");
    }
    if (url.pathname === "/caixa") {
      if (req.method === "DELETE") {
        caixa.length = 0;
        return json(res, 200, { ok: true });
      }
      return json(res, 200, caixa);
    }
    json(res, 404, { erro: "não existe" });
  });

  return new Promise((resolve, reject) => {
    servidor.once("error", reject);
    servidor.listen(porta, host, () =>
      resolve({
        caixa,
        porta: servidor.address().port,
        /** muda quantos e-mails "o Gmail" ainda deixa mandar hoje (para testar a cota) */
        definirCota: (n) => {
          cotaDoDia = n;
        },
        fechar: () => new Promise((ok) => servidor.close(ok)),
      })
    );
  });
}

// Rodando direto (npm run ponte-falsa): fica no ar até você apertar Ctrl+C.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const porta = Number(process.env.PORTA || 8787);
  iniciarPonteFalsa({ porta, segredo: process.env.APPS_SCRIPT_SEGREDO || SEGREDO_PADRAO }).then(() => {
    console.log(`Ponte de e-mail FALSA no ar em http://127.0.0.1:${porta}/exec`);
    console.log("Os e-mails \"enviados\" aparecem em http://127.0.0.1:" + porta + "/caixa");
  });
}
