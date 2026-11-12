// Lista dos eventos do organizador + criação de evento novo.

import { h, trocarConteudo, carregando, definirTitulo, aviso } from "../ui.js";
import { dataLonga, moeda } from "../formatar.js";
import { avisarErro, formularioEvento, tratarErro } from "./comum.js";

export function telaEventos(ctx) {
  const { api, ir } = ctx;
  definirTitulo("Meus eventos");
  const raiz = h("div", { class: "tela" }, carregando());

  async function carregar() {
    trocarConteudo(raiz, carregando());
    try {
      desenhar(await api.listarEventos());
    } catch (e) {
      tratarErro(ctx, e, raiz, carregar);
    }
  }

  async function novoEvento() {
    const dados = await formularioEvento({ titulo: "Novo evento", rotulo: "Criar evento" });
    if (!dados) return;
    try {
      const evento = await api.criarEvento(dados);
      aviso("Evento criado! Agora adicione os participantes.", "ok");
      ir(`#/evento/${evento.id}`);
    } catch (e) {
      avisarErro(ctx, e);
    }
  }

  function cartao(evento) {
    const total = evento.participantes.length;
    const comEmail = evento.participantes.filter((p) => p.email).length;
    const estado = evento.sorteado_em
      ? h("span", { class: "chip ok" }, "Sorteio feito ✓")
      : total === 0
        ? h("span", { class: "chip aguardando" }, "Sem participantes ainda")
        : h("span", { class: comEmail === total && total >= 3 ? "chip ok" : "chip aguardando" }, `${comEmail} de ${total} com e-mail`);
    return h(
      "li",
      {},
      h(
        "a",
        { class: "evento-card", href: `#/evento/${evento.id}` },
        h("span", { class: "evento-nome" }, evento.nome),
        h("span", { class: "meta" }, `📅 ${dataLonga(evento.data_evento)}`, " · ", `🎁 ${Number(evento.valor) > 0 ? moeda(evento.valor) : "valor livre"}`),
        estado,
      ),
    );
  }

  function desenhar(eventos) {
    trocarConteudo(
      raiz,
      h("div", { class: "cabecalho-pagina" }, h("h1", {}, "Meus eventos"), h("button", { class: "botao", onclick: novoEvento }, "+ Novo evento")),
      eventos.length > 0
        ? h("ul", { class: "lista-eventos" }, eventos.map(cartao))
        : h(
            "div",
            { class: "cartao vazio" },
            h("div", { class: "laco", "aria-hidden": "true" }, "🎄"),
            h("h2", {}, "Nenhum evento ainda"),
            h("p", { class: "suave" }, "Crie o primeiro: dê um nome, escolha a data e o valor do presente. Depois é só adicionar os participantes e mandar o link."),
            h("button", { class: "botao", onclick: novoEvento }, "Criar o primeiro evento"),
          ),
      h("p", { class: "dica centro" }, h("a", { href: "#/diagnostico" }, "Testar a conexão e o envio de e-mail")),
    );
  }

  carregar();
  return raiz;
}
