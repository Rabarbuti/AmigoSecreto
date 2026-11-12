// API de verdade: fala com o Supabase (banco, login e a função "sorteio").
// A API de demonstração (api-demo.js) tem exatamente os mesmos métodos.

import { ErroApp, traduzirErro } from "./erros.js";
import { UUID } from "./formatar.js";

const CAMPOS_EVENTO = "id, nome, data_evento, valor, recado, token_publico, sorteado_em, sorteio_numero, criado_em";
const CAMPOS_PARTICIPANTE = "id, nome, email, email_enviado_em, erro_envio";

function normalizarEvento(e) {
  return { ...e, valor: Number(e.valor) };
}

const porNome = (a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" });

/** Interpreta a resposta PÚBLICA do servidor de login (/auth/v1/settings). null se não der para entender. */
export function lerConfiguracaoDeLogin(json) {
  if (!json || typeof json.disable_signup !== "boolean") return null;
  return { cadastroAberto: json.disable_signup === false, confirmacaoAutomatica: json.mailer_autoconfirm === true };
}

export function criarApiSupabase({ supabaseUrl, supabaseKey }) {
  const sb = window.supabase.createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      // chave própria: todos os sites de um mesmo usuário no GitHub Pages dividem o localStorage
      storageKey: "amigo-secreto.sessao",
    },
  });

  /** Espera a promessa do supabase-js, joga o erro traduzido e devolve só os dados. */
  async function dados(promessa) {
    let resposta;
    try {
      resposta = await promessa;
    } catch (e) {
      throw traduzirErro(e);
    }
    if (resposta.error) throw traduzirErro(resposta.error);
    return resposta.data;
  }

  const usuario = (sessao) => (sessao ? { id: sessao.user.id, email: sessao.user.email ?? "" } : null);

  async function chamarFuncao(corpo) {
    let resposta;
    try {
      resposta = await sb.functions.invoke("sorteio", { body: corpo });
    } catch (e) {
      throw traduzirErro(e);
    }
    if (resposta.error) throw await erroDaFuncao(resposta.error);
    return resposta.data;
  }

  return {
    modo: "supabase",

    infoConexao: () => ({ url: supabaseUrl }),

    // ------------------------------------------------ login
    async sessaoAtual() {
      const { data } = await sb.auth.getSession();
      return usuario(data.session);
    },
    aoMudarSessao(chamar) {
      const { data } = sb.auth.onAuthStateChange((_evento, sessao) => chamar(usuario(sessao)));
      return () => data.subscription.unsubscribe();
    },
    async entrar(email, senha) {
      try {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: senha });
        if (error) throw error;
      } catch (e) {
        throw traduzirErro(e);
      }
    },
    async sair() {
      await sb.auth.signOut();
    },

    // ------------------------------------------------ eventos (só do dono, pelo RLS)
    async listarEventos() {
      const linhas = await dados(
        sb.from("eventos").select(`${CAMPOS_EVENTO}, participantes(id, email)`).order("data_evento", { ascending: false }),
      );
      return linhas.map(normalizarEvento);
    },

    async buscarEvento(id) {
      if (!UUID.test(id)) throw new ErroApp("Evento não encontrado.", { codigo: "nao_encontrado" });
      const linha = await dados(
        sb.from("eventos").select(`${CAMPOS_EVENTO}, participantes(${CAMPOS_PARTICIPANTE})`).eq("id", id).maybeSingle(),
      );
      if (!linha) throw new ErroApp("Evento não encontrado (ou ele é de outra conta).", { codigo: "nao_encontrado" });
      return { ...normalizarEvento(linha), participantes: [...linha.participantes].sort(porNome) };
    },

    async criarEvento({ nome, data_evento, valor, recado }) {
      const linha = await dados(
        sb.from("eventos").insert({ nome, data_evento, valor, recado: recado || null }).select(CAMPOS_EVENTO).single(),
      );
      return { ...normalizarEvento(linha), participantes: [] };
    },

    async atualizarEvento(id, { nome, data_evento, valor, recado }) {
      await dados(sb.from("eventos").update({ nome, data_evento, valor, recado: recado || null }).eq("id", id).select("id").single());
    },

    async apagarEvento(id) {
      await dados(sb.from("eventos").delete().eq("id", id));
    },

    // ------------------------------------------------ participantes
    async adicionarParticipantes(eventoId, nomes) {
      // (num insert em lote todos os objetos precisam ter as mesmas chaves)
      const linhas = await dados(
        sb.from("participantes").insert(nomes.map((nome) => ({ evento_id: eventoId, nome }))).select(CAMPOS_PARTICIPANTE),
      );
      return linhas;
    },

    async atualizarEmail(participanteId, email) {
      await dados(sb.from("participantes").update({ email: email || null }).eq("id", participanteId).select("id").single());
    },

    async removerParticipante(id) {
      const linhas = await dados(sb.from("participantes").delete().eq("id", id).select("id"));
      if (linhas.length === 0) {
        throw new ErroApp("Não consegui remover. Se o sorteio já foi feito, a lista não pode mais mudar.", { codigo: "permissao" });
      }
    },

    // ------------------------------------------------ função "sorteio" (servidor)
    sortear: (eventoId) => chamarFuncao({ acao: "sortear", evento_id: eventoId }),
    /** Cancela o sorteio atual e libera a lista (só o dono). Depois é preciso sortear de novo. */
    async reabrirSorteio(eventoId) {
      await dados(sb.rpc("reabrir_sorteio", { p_evento_id: eventoId }));
    },
    reenviar: (eventoId, participanteId = null) =>
      chamarFuncao({ acao: "reenviar", evento_id: eventoId, participante_id: participanteId }),
    testarEmail: () => chamarFuncao({ acao: "testar_email" }),
    diagnosticoFuncao: () => chamarFuncao({ acao: "diagnostico" }),

    // ------------------------------------------------ link público (sem login)
    async eventoPublico(token) {
      if (!UUID.test(token)) return null;
      return await dados(sb.rpc("evento_publico", { p_token: token }));
    },

    async confirmarEmail(token, participanteId, email) {
      if (!UUID.test(token) || !UUID.test(participanteId)) return { ok: false, erro: "evento_nao_encontrado" };
      return await dados(sb.rpc("confirmar_email", { p_token: token, p_participante_id: participanteId, p_email: email }));
    },

    async versaoDoEsquema() {
      return await dados(sb.rpc("versao_do_esquema"));
    },

    /** O cadastro de novos usuários precisa estar desligado (senão estranhos usam o seu envio de e-mail). */
    async configuracaoDeLogin() {
      try {
        const resposta = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: supabaseKey } });
        return resposta.ok ? lerConfiguracaoDeLogin(await resposta.json()) : null;
      } catch {
        return null;
      }
    },
  };
}

/** Transforma a resposta de erro da função (HTTP 4xx/5xx) numa mensagem que ajuda. */
async function erroDaFuncao(erro) {
  const resposta = erro?.context;
  let corpo = null;
  if (resposta && typeof resposta.json === "function") {
    try {
      corpo = await resposta.clone().json();
    } catch {
      corpo = null;
    }
  }
  if (corpo?.erro) return new ErroApp(corpo.erro, { ...corpo, codigo: corpo.codigo ?? null });

  const status = resposta?.status;
  if (status === 404 || /not.?found/i.test(String(corpo?.message ?? ""))) {
    return new ErroApp(
      'A função "sorteio" não está no seu projeto do Supabase. Faça o deploy dela (README, passo 5).',
      { codigo: "funcao_ausente" },
    );
  }
  if (status === 401) return new ErroApp("Sua sessão expirou. Entre de novo.", { codigo: "sessao" });
  return traduzirErro(erro?.name === "FunctionsHttpError" ? new Error("A função de sorteio falhou. Tente de novo em instantes.") : erro);
}
