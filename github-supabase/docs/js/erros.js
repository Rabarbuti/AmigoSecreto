// Erros que o site mostra para a pessoa, sempre em português e com o que fazer a seguir.

export class ErroApp extends Error {
  constructor(mensagem, extra = {}) {
    super(mensagem);
    this.name = "ErroApp";
    this.codigo = extra.codigo ?? null;
    this.extra = extra;
  }
}

export const MSG_REDE =
  "Não consegui falar com o servidor. Confira a sua internet. Se estiver tudo certo, o projeto do " +
  "Supabase pode estar pausado (o plano grátis pausa depois de 1 semana sem uso): abra " +
  'supabase.com/dashboard e clique em "Restore project".';

/** Converte o erro cru do supabase-js / do navegador numa mensagem que ajuda. */
export function traduzirErro(e) {
  if (e instanceof ErroApp) return e;
  const msg = String(e?.message ?? e ?? "");
  const codigo = e?.code ?? null;

  if (codigo === "invalid_credentials" || /invalid login credentials/i.test(msg)) {
    return new ErroApp("E-mail ou senha incorretos.", { codigo: "credenciais" });
  }
  if (/evento_nao_encontrado/.test(msg)) {
    return new ErroApp("Evento não encontrado.", { codigo: "nao_encontrado" });
  }
  if (codigo === "over_request_rate_limit" || e?.status === 429) {
    return new ErroApp("Muitas tentativas seguidas. Espere um minuto e tente de novo.", { codigo: "limite" });
  }
  if (codigo === "23505") {
    return new ErroApp("Já existe alguém com esse nome neste evento.", { codigo });
  }
  if (codigo === "23514") {
    if (/Limite de 50/i.test(msg)) return new ErroApp("Cada evento aceita até 50 participantes.", { codigo });
    return new ErroApp("Algum dado ficou fora do permitido. Confira os campos e tente de novo.", { codigo });
  }
  if (codigo === "42501" || /row-level security|permission denied/i.test(msg)) {
    return new ErroApp(
      "Sem permissão para isso. Se o sorteio já foi feito, a lista de participantes não pode mais mudar.",
      { codigo: "permissao" },
    );
  }
  if (codigo === "PGRST301" || /jwt (expired|invalid)|invalid jwt/i.test(msg)) {
    return new ErroApp("Sua sessão expirou. Entre de novo.", { codigo: "sessao" });
  }
  if (codigo === "PGRST202" || codigo === "PGRST205" || codigo === "42P01" || /could not find the (function|table)/i.test(msg)) {
    return new ErroApp(
      "O banco ainda não tem as tabelas e funções deste site. Rode o arquivo SQL de supabase/migrations " +
        "(README, passo 3) e tente de novo.",
      { codigo: "esquema" },
    );
  }
  if (codigo === "PGRST116") {
    return new ErroApp("Não encontrei isso (ou você não tem acesso).", { codigo });
  }
  if (
    e instanceof TypeError ||
    e?.name === "AuthRetryableFetchError" ||
    e?.name === "FunctionsFetchError" ||
    /failed to fetch|networkerror|load failed|network request failed/i.test(msg)
  ) {
    return new ErroApp(MSG_REDE, { codigo: "rede" });
  }
  return new ErroApp(msg || "Algo deu errado. Tente de novo.", { codigo });
}
