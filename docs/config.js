// Configuração do site: preencha com os dados do SEU projeto do Supabase.
//
// Onde achar (painel do Supabase > botão "Connect" ou Project Settings > API Keys):
//   supabaseUrl: "Project URL", algo como https://abcdefgh.supabase.co
//   supabaseKey: a chave PUBLISHABLE, que começa com sb_publishable_
//                (projetos mais antigos: a chave "anon", que começa com eyJ...)
//
// Estes dois valores são PÚBLICOS por natureza: quem abrir o site consegue vê-los, e o
// banco é protegido por regras (RLS), não por segredo. O que NUNCA pode vir para cá é a
// chave "secret" (sb_secret_...) ou "service_role": o site se recusa a abrir se achar uma.
//
// Enquanto os valores abaixo não forem trocados, o site roda em MODO DEMONSTRAÇÃO
// (dados de mentirinha, nenhum e-mail enviado).

window.AMIGO_SECRETO_CONFIG = {
  supabaseUrl: "https://dscghbaxyhlhtfblcgxe.supabase.co",
  supabaseKey: "sb_publishable_XmucYaLSP6OuTWqM84RuyQ_sReNhXi9",
};
