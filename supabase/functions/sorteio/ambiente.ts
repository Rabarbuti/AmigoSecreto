// Leitura dos segredos da função (variáveis de ambiente). Separado do index.ts para poder
// ser testado fora do Supabase.

import { correioAppsScript } from "./correio.ts";
import type { Correio } from "./tipos.ts";

export type Ambiente = Record<string, string | undefined>;

/**
 * Chave secreta do projeto (a que ignora o RLS). Aceita o formato novo
 * (SUPABASE_SECRET_KEYS, um JSON com as chaves "sb_secret_...") e os antigos
 * (SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY), que o Supabase está aposentando.
 */
export function chaveSecreta(env: Ambiente): string | null {
  const json = env.SUPABASE_SECRET_KEYS;
  if (json) {
    try {
      const chaves = JSON.parse(json) as Record<string, unknown>;
      if (typeof chaves.default === "string" && chaves.default) return chaves.default;
      const primeira = Object.values(chaves).find((v) => typeof v === "string" && v !== "");
      if (typeof primeira === "string") return primeira;
    } catch {
      // JSON inválido: tenta as variáveis simples
    }
  }
  return env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || null;
}

const HOSPEDEIROS_LOCAIS = ["localhost", "127.0.0.1", "host.docker.internal"];

/** O endereço da ponte precisa ser https (o segredo viaja nele); http só vale para testes no seu computador. */
export function urlDaPonteValida(texto: string): boolean {
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && HOSPEDEIROS_LOCAIS.includes(url.hostname);
}

/**
 * Monta o correio a partir dos segredos da função.
 * correio = null quando falta configurar ou quando algo está errado; `problema` explica o motivo.
 */
export function avaliarCorreioDoAmbiente(env: Ambiente): { correio: Correio | null; problema: string | null } {
  const url = env.APPS_SCRIPT_URL?.trim();
  const segredo = env.APPS_SCRIPT_SEGREDO?.trim();
  if (!url || !segredo) return { correio: null, problema: null };
  if (!urlDaPonteValida(url)) {
    return {
      correio: null,
      problema: "o APPS_SCRIPT_URL precisa começar com https:// (copie de novo o endereço do app da Web, o que termina em /exec).",
    };
  }
  return {
    correio: correioAppsScript({ url, segredo, nomeRemetente: env.NOME_REMETENTE?.trim() || undefined }),
    problema: null,
  };
}

/** Só o correio (null = não configurado ou inválido). */
export function criarCorreioDoAmbiente(env: Ambiente): Correio | null {
  return avaliarCorreioDoAmbiente(env).correio;
}

/**
 * ORGANIZADORES_PERMITIDOS: e-mails separados por vírgula, espaço ou ponto e vírgula.
 * Vazio/ausente = qualquer usuário logado pode (o cadastro aberto precisa estar desligado no Supabase).
 */
export function listaDeOrganizadores(texto: string | undefined): string[] | null {
  const lista = (texto ?? "")
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return lista.length > 0 ? lista : null;
}
