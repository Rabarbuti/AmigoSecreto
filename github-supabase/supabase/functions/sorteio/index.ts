// Função "sorteio" (Supabase Edge Function): sorteia o amigo secreto e envia os e-mails.
// A lógica fica em nucleo.ts; aqui só ligamos o Supabase (login, banco) e o CORS.
//
// Segredos (Supabase > Edge Functions > Secrets, ou `npx supabase secrets set`):
//   APPS_SCRIPT_URL      endereço do app da Web da "ponte de e-mail" (pasta apps-script/)
//   APPS_SCRIPT_SEGREDO  o mesmo segredo que está dentro do Code.gs da ponte
//   NOME_REMETENTE       (opcional) nome que aparece como remetente; padrão "Amigo Secreto"
//   ORGANIZADORES_PERMITIDOS  (opcional) e-mails que podem usar a função, separados por vírgula.
//                        Só faz diferença se um dia você deixar o cadastro aberto no Supabase.
// As chaves do Supabase (SUPABASE_URL, SUPABASE_SECRET_KEYS...) já vêm prontas no ambiente.

import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { avaliarCorreioDoAmbiente, chaveSecreta, listaDeOrganizadores } from "./ambiente.ts";
import { executar } from "./nucleo.ts";
import type { Banco, Evento, Participante } from "./tipos.ts";

const CABECALHOS_PADRAO = "authorization, x-client-info, apikey, content-type";

// A função só obedece a quem manda um login válido de organizador, então liberar o CORS
// para qualquer site não abre nenhuma porta.
function cors(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": req.headers.get("Access-Control-Request-Headers") ?? CABECALHOS_PADRAO,
    "Access-Control-Max-Age": "86400",
  };
}

function json(req: Request, status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      ...cors(req),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { erro: "Use POST." });

  const env = Deno.env.toObject();
  const chave = chaveSecreta(env);
  if (!env.SUPABASE_URL || !chave) {
    console.error("sorteio: faltam SUPABASE_URL ou a chave secreta no ambiente.");
    return json(req, 500, { erro: "A função está sem as chaves do Supabase." });
  }

  // O gateway do Supabase não confere o login desta função (verify_jwt = false em config.toml:
  // a checagem dele só entende as chaves JWT antigas e pode recusar usuários de projetos novos).
  // Por isso quem é o usuário é conferido aqui, no servidor de login, antes de qualquer outra coisa.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json(req, 401, { erro: "Entre no site para continuar." });

  const admin = createClient(env.SUPABASE_URL, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return json(req, 401, { erro: "Sua sessão expirou. Entre de novo." });

  let pedido: unknown;
  try {
    pedido = await req.json();
  } catch {
    return json(req, 400, { erro: "Pedido inválido." });
  }

  const { correio, problema } = avaliarCorreioDoAmbiente(env);
  const resposta = await executar(
    pedido,
    { id: data.user.id, email: data.user.email ?? null, anonimo: data.user.is_anonymous === true },
    {
      banco: criarBanco(admin),
      correio,
      problemaDoCorreio: problema,
      organizadoresPermitidos: listaDeOrganizadores(env.ORGANIZADORES_PERMITIDOS),
    },
  );
  return json(req, resposta.status, resposta.corpo);
});

// deno-lint-ignore no-explicit-any
function criarBanco(admin: any): Banco {
  return {
    async buscarEvento(id) {
      const { data, error } = await admin
        .from("eventos")
        .select("id, dono_id, nome, data_evento, valor, recado, sorteado_em, sorteio_numero")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? ({ ...data, valor: Number(data.valor) } as Evento) : null;
    },

    async listarParticipantes(eventoId) {
      const { data, error } = await admin
        .from("participantes")
        .select("id, evento_id, nome, email, email_enviado_em, erro_envio")
        .eq("evento_id", eventoId)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Participante[];
    },

    async gravarSorteio(eventoId, pares) {
      const { data, error } = await admin.rpc("gravar_sorteio", {
        p_evento_id: eventoId,
        p_pares: pares,
      });
      if (error) throw error;
      return Number(data);
    },

    async lerSorteio(eventoId) {
      const { data, error } = await admin.rpc("ler_sorteio", { p_evento_id: eventoId });
      if (error) throw error;
      return ((data ?? []) as { participante_id: string; tirou_id: string }[]).map((l) => ({
        de: l.participante_id,
        para: l.tirou_id,
      }));
    },

    async marcarEnvio(participanteId, erro) {
      const { error } = await admin
        .from("participantes")
        .update({ email_enviado_em: erro ? null : new Date().toISOString(), erro_envio: erro })
        .eq("id", participanteId);
      if (error) throw error;
    },
  };
}
