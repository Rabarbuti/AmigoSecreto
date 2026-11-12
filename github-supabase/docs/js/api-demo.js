// API de DEMONSTRAÇÃO: tudo na memória do navegador, para ver o site funcionando sem Supabase.
// Nada é salvo (recarregar a página volta ao começo) e nenhum e-mail é enviado.
// Tem os mesmos métodos da API de verdade (api.js).

import { ErroApp } from "./erros.js";
import { emailValido, normalizarEmail } from "./formatar.js";

const ESPERA = 220; // finge o tempo da rede

const espera = (ms = ESPERA) => new Promise((resolver) => setTimeout(resolver, ms));

export function criarApiDemo() {
  let proximoId = 1;
  const novoId = () => `demo-${proximoId++}`;
  let sessao = null;
  const ouvintes = new Set();

  const pessoa = (nome, email = null, enviado = false) => ({
    id: novoId(),
    nome,
    email,
    email_enviado_em: enviado ? new Date().toISOString() : null,
    erro_envio: null,
  });

  const eventos = [
    {
      id: novoId(),
      nome: "Natal da Família (exemplo)",
      data_evento: "2026-12-20",
      valor: 50,
      recado: "Troca na casa da vovó, depois do almoço.",
      token_publico: "demo",
      sorteado_em: null,
      sorteio_numero: 0,
      participantes: [
        pessoa("Ana", "ana@exemplo.com"),
        pessoa("Bruno", "bruno@exemplo.com"),
        pessoa("Carla"),
        pessoa("Davi"),
        pessoa("Elisa"),
      ],
    },
    {
      id: novoId(),
      nome: "Amigo secreto do trabalho (exemplo)",
      data_evento: "2026-12-12",
      valor: 30,
      recado: null,
      token_publico: "demo-trabalho",
      sorteado_em: new Date(Date.now() - 86400000).toISOString(),
      sorteio_numero: 1,
      participantes: [
        pessoa("Fernanda", "fernanda@exemplo.com", true),
        pessoa("Gustavo", "gustavo@exemplo.com", true),
        pessoa("Helena", "helena@exemplo.com", true),
      ],
    },
  ];

  const achar = (id) => {
    const evento = eventos.find((e) => e.id === id);
    if (!evento) throw new ErroApp("Evento não encontrado.", { codigo: "nao_encontrado" });
    return evento;
  };
  const copia = (x) => structuredClone(x);
  const exigirLogin = () => {
    if (!sessao) throw new ErroApp("Sua sessão expirou. Entre de novo.", { codigo: "sessao" });
  };
  /** Igual ao banco de verdade: depois do sorteio a lista fica travada (nomes e e-mails). */
  const exigirSorteioAberto = (evento) => {
    if (evento.sorteado_em) {
      throw new ErroApp("Sem permissão para isso. Se o sorteio já foi feito, a lista de participantes não pode mais mudar.", {
        codigo: "permissao",
      });
    }
  };

  /** Finge o envio de um e-mail a cada pessoa. Endereços @falha.test "falham", para ver o caminho de erro. */
  function fingirEnvio(evento, alvos) {
    const falhas = [];
    let enviados = 0;
    for (const p of alvos) {
      if (!p.email) {
        p.erro_envio = "Sem e-mail cadastrado.";
        falhas.push({ participante_id: p.id, nome: p.nome, erro: p.erro_envio });
      } else if (p.email.endsWith("@falha.test")) {
        p.email_enviado_em = null;
        p.erro_envio = "Caixa de entrada cheia (falha simulada).";
        falhas.push({ participante_id: p.id, nome: p.nome, erro: p.erro_envio });
      } else {
        p.email_enviado_em = new Date().toISOString();
        p.erro_envio = null;
        enviados++;
      }
    }
    return { total: alvos.length, numero: evento.sorteio_numero, enviados, falhas };
  }

  return {
    modo: "demo",

    infoConexao: () => ({ url: null }),

    // ------------------------------------------------ login (qualquer e-mail e senha entram)
    async sessaoAtual() {
      return sessao;
    },
    aoMudarSessao(chamar) {
      ouvintes.add(chamar);
      return () => ouvintes.delete(chamar);
    },
    async entrar(email, senha) {
      await espera();
      if (!email.trim() || !senha) throw new ErroApp("E-mail ou senha incorretos.");
      sessao = { id: "demo-usuario", email: email.trim() };
      ouvintes.forEach((chamar) => chamar(sessao));
    },
    async sair() {
      sessao = null;
      ouvintes.forEach((chamar) => chamar(null));
    },

    // ------------------------------------------------ eventos
    async listarEventos() {
      exigirLogin();
      await espera();
      return copia(eventos.map((e) => ({ ...e, participantes: e.participantes.map(({ id, email }) => ({ id, email })) })));
    },
    async buscarEvento(id) {
      exigirLogin();
      await espera();
      return copia(achar(id));
    },
    async criarEvento({ nome, data_evento, valor, recado }) {
      exigirLogin();
      await espera();
      const evento = {
        id: novoId(),
        nome,
        data_evento,
        valor,
        recado: recado || null,
        token_publico: `demo-${novoId()}`,
        sorteado_em: null,
        sorteio_numero: 0,
        participantes: [],
      };
      eventos.unshift(evento);
      return copia(evento);
    },
    async atualizarEvento(id, { nome, data_evento, valor, recado }) {
      exigirLogin();
      await espera();
      Object.assign(achar(id), { nome, data_evento, valor, recado: recado || null });
    },
    async apagarEvento(id) {
      exigirLogin();
      await espera();
      eventos.splice(eventos.indexOf(achar(id)), 1);
    },

    // ------------------------------------------------ participantes
    async adicionarParticipantes(eventoId, nomes) {
      exigirLogin();
      await espera();
      const evento = achar(eventoId);
      exigirSorteioAberto(evento);
      if (evento.participantes.length + nomes.length > 50) throw new ErroApp("Cada evento aceita até 50 participantes.");
      const novos = nomes.map((nome) => pessoa(nome));
      evento.participantes.push(...novos);
      return copia(novos);
    },
    async atualizarEmail(participanteId, email) {
      exigirLogin();
      await espera(120);
      for (const evento of eventos) {
        const p = evento.participantes.find((x) => x.id === participanteId);
        if (p) {
          exigirSorteioAberto(evento);
          p.email = email ? normalizarEmail(email) : null;
          p.email_enviado_em = null;
          p.erro_envio = null;
          return;
        }
      }
      throw new ErroApp("Não encontrei esse participante.");
    },
    async removerParticipante(id) {
      exigirLogin();
      await espera(120);
      for (const evento of eventos) {
        const i = evento.participantes.findIndex((x) => x.id === id);
        if (i >= 0) {
          exigirSorteioAberto(evento);
          evento.participantes.splice(i, 1);
          return;
        }
      }
    },

    // ------------------------------------------------ "servidor" de mentirinha
    async sortear(eventoId) {
      exigirLogin();
      await espera(900);
      const evento = achar(eventoId);
      if (evento.sorteado_em) {
        throw new ErroApp('O sorteio já foi feito. Para sortear de novo, use "Refazer o sorteio": ele cancela este e libera a lista para você corrigir o que precisar.', {
          codigo: "sorteio_ja_realizado",
        });
      }
      if (evento.participantes.length < 3) throw new ErroApp("Cadastre pelo menos 3 participantes para sortear.", { codigo: "participantes_insuficientes" });
      const faltando = evento.participantes.filter((p) => !p.email).map((p) => p.nome);
      if (faltando.length) throw new ErroApp(`Ainda sem e-mail: ${faltando.join(", ")}.`, { codigo: "email_faltando", faltando });
      // Na demonstração o sorteio não é nem calculado: ninguém veria o resultado mesmo.
      evento.sorteado_em = new Date().toISOString();
      evento.sorteio_numero += 1;
      return fingirEnvio(evento, evento.participantes);
    },
    async reabrirSorteio(eventoId) {
      exigirLogin();
      await espera(300);
      const evento = achar(eventoId);
      evento.sorteado_em = null;
      for (const p of evento.participantes) {
        p.email_enviado_em = null;
        p.erro_envio = null;
      }
    },
    async reenviar(eventoId, participanteId = null) {
      exigirLogin();
      await espera(500);
      const evento = achar(eventoId);
      if (!evento.sorteado_em) throw new ErroApp("O sorteio ainda não foi feito.", { codigo: "sem_sorteio" });
      const alvos = participanteId
        ? evento.participantes.filter((p) => p.id === participanteId)
        : evento.participantes.filter((p) => !p.email_enviado_em);
      return fingirEnvio(evento, alvos);
    },
    async testarEmail() {
      exigirLogin();
      await espera(500);
      return { ok: true, enviado_para: sessao.email };
    },
    async diagnosticoFuncao() {
      exigirLogin();
      await espera(200);
      return { ok: true, correio: true, usuario: sessao.email, cota: 100, problema: null };
    },

    // ------------------------------------------------ link público
    async eventoPublico(token) {
      await espera();
      const evento = eventos.find((e) => e.token_publico === token);
      if (!evento) return null;
      return {
        nome: evento.nome,
        data_evento: evento.data_evento,
        valor: evento.valor,
        recado: evento.recado,
        sorteado: evento.sorteado_em !== null,
        participantes: [...evento.participantes]
          .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
          .map((p) => ({ id: p.id, nome: p.nome, confirmado: p.email !== null })),
      };
    },
    async confirmarEmail(token, participanteId, email) {
      await espera();
      const evento = eventos.find((e) => e.token_publico === token);
      if (!evento) return { ok: false, erro: "evento_nao_encontrado" };
      if (evento.sorteado_em) return { ok: false, erro: "sorteio_ja_realizado" };
      if (!emailValido(email)) return { ok: false, erro: "email_invalido" };
      const p = evento.participantes.find((x) => x.id === participanteId);
      if (!p) return { ok: false, erro: "participante_nao_encontrado" };
      if (p.email) return { ok: false, erro: "ja_confirmado" };
      p.email = normalizarEmail(email);
      return { ok: true, nome: p.nome };
    },

    async versaoDoEsquema() {
      return 1;
    },

    async configuracaoDeLogin() {
      return { cadastroAberto: false, confirmacaoAutomatica: false };
    },
  };
}
