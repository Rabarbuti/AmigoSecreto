// Envio de e-mail pela "ponte" do Gmail: um pequeno Google Apps Script (veja a pasta
// apps-script/ do projeto) que recebe um POST com o e-mail pronto e o envia pela conta
// Google de quem o implantou. É de graça, não exige domínio próprio e o e-mail sai de
// um Gmail de verdade (por isso costuma cair na caixa de entrada).
//
// Por que não SMTP direto: as Edge Functions do Supabase bloqueiam as portas 25 e 587.

import type { Correio, Mensagem } from "./tipos.ts";

export type OpcoesAppsScript = {
  url: string;
  segredo: string;
  nomeRemetente?: string;
  /** só os testes trocam isto */
  fetchFn?: typeof fetch;
  timeoutMs?: number;
};

type RespostaDaPonte = { ok?: boolean; erro?: string; cota_restante?: number };

export function correioAppsScript(op: OpcoesAppsScript): Correio {
  const chamar = op.fetchFn ?? fetch;

  /** Faz o POST e devolve o JSON da ponte. O endereço da ponte nunca entra nas mensagens de erro. */
  async function perguntar(corpo: Record<string, unknown>): Promise<RespostaDaPonte> {
    let resposta: Response;
    try {
      // O Apps Script responde ao POST com um redirecionamento (302) para o resultado;
      // o fetch segue sozinho.
      resposta = await chamar(op.url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ segredo: op.segredo, ...corpo }),
        redirect: "follow",
        signal: AbortSignal.timeout(op.timeoutMs ?? 30_000),
      });
    } catch (e) {
      if (e instanceof Error && e.name === "TimeoutError") {
        throw new Error("A ponte de e-mail (Apps Script) demorou demais para responder.");
      }
      throw new Error("Não consegui falar com a ponte de e-mail (Apps Script).");
    }

    const texto = await resposta.text();
    let json: RespostaDaPonte | null = null;
    try {
      json = JSON.parse(texto);
    } catch {
      // a resposta não é JSON (ex.: uma página de erro do Google)
    }
    if (!json || typeof json !== "object") {
      throw new Error(
        `A ponte de e-mail respondeu algo inesperado (HTTP ${resposta.status}). ` +
          'Confira se a implantação do Apps Script está com acesso "Qualquer pessoa".',
      );
    }
    return json;
  }

  return {
    async enviar(m: Mensagem): Promise<void> {
      const json = await perguntar({
        nome: op.nomeRemetente ?? "Amigo Secreto",
        para: m.para,
        assunto: m.assunto,
        html: m.html,
        texto: m.texto,
      });
      if (!json.ok) throw new Error(String(json.erro || "A ponte de e-mail recusou o envio."));
    },

    /** Quantos e-mails o Gmail ainda deixa mandar hoje (null se a ponte não souber dizer). */
    async cota(): Promise<number | null> {
      const json = await perguntar({ acao: "cota" });
      return json.ok && typeof json.cota_restante === "number" ? json.cota_restante : null;
    },
  };
}
