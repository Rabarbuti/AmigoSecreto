// Página de um evento (organizador): link, participantes, sorteio.

import { h, trocarConteudo, carregando, definirTitulo, aviso, confirmar, copiarTexto, comTrava } from "../ui.js";
import {
  dataHora, dataLonga, emailsParecidos, emailValido, linkDoConvite, linkWhatsapp, moeda, normalizarEmail, plural,
  separarNomes, textoDoConvite,
} from "../formatar.js";
import { avisarErro, formularioEvento, tratarErro } from "./comum.js";

const MAXIMO_PARTICIPANTES = 50;

export function telaEvento(ctx, id) {
  const { api, ir } = ctx;
  const raiz = h("div", { class: "tela" }, carregando());

  let evento = null;
  let editandoEmail = null; // id do participante com o campo de e-mail aberto
  let ocupado = null; // texto enquanto uma ação demorada roda (sortear, refazer…)
  let rascunhoNomes = ""; // o que a pessoa digitou em "adicionar", para não perder ao redesenhar

  async function carregar(mostrarCarregando = true) {
    if (mostrarCarregando) trocarConteudo(raiz, carregando());
    try {
      evento = await api.buscarEvento(id);
      definirTitulo(evento.nome);
      desenhar();
    } catch (e) {
      tratarErro(ctx, e, raiz, () => carregar());
    }
  }

  function desenhar() {
    trocarConteudo(raiz, cabecalho(), secaoLink(), secaoParticipantes(), secaoSorteio(), secaoApagar());
  }

  const sorteado = () => evento.sorteado_em !== null;

  // ------------------------------------------------------------ cabeçalho

  async function editarDados() {
    const dados = await formularioEvento({ titulo: "Editar evento", rotulo: "Salvar", valores: evento });
    if (!dados) return;
    try {
      await api.atualizarEvento(evento.id, dados);
      aviso("Dados do evento salvos.", "ok");
      await carregar(false);
    } catch (e) {
      avisarErro(ctx, e);
    }
  }

  function cabecalho() {
    return h(
      "section",
      { class: "cartao" },
      h("a", { class: "voltar", href: "#/eventos" }, "← Meus eventos"),
      h("h1", {}, evento.nome),
      h("p", { class: "meta" }, `📅 ${dataLonga(evento.data_evento)}`, " · ", `🎁 ${evento.valor > 0 ? moeda(evento.valor) : "valor livre"}`),
      evento.recado ? h("p", { class: "recado" }, evento.recado) : null,
      h("button", { class: "botao secundario mini", onclick: editarDados }, "Editar dados do evento"),
    );
  }

  // ------------------------------------------------------------ link

  function secaoLink() {
    const link = linkDoConvite(location.origin + location.pathname, evento.token_publico);
    const campoLink = h("input", {
      id: "link-convite",
      type: "text",
      readonly: true,
      value: link,
      "aria-label": "Link para os participantes",
      onclick: (e) => e.target.select(),
    });
    return h(
      "section",
      { class: "cartao" },
      h("h2", {}, "Link para os participantes"),
      h("p", { class: "suave" }, "Mande este link no grupo. Cada pessoa escolhe o próprio nome na lista e digita o e-mail."),
      h(
        "div",
        { class: "linha-copiar" },
        campoLink,
        h(
          "button",
          {
            class: "botao",
            onclick: async () => {
              campoLink.select();
              aviso((await copiarTexto(link)) ? "Link copiado!" : "Não consegui copiar sozinho: selecione o link e copie.", "ok");
            },
          },
          "Copiar",
        ),
      ),
      h("a", { class: "botao secundario", href: linkWhatsapp(textoDoConvite(evento, link)), target: "_blank", rel: "noopener noreferrer" }, "Enviar pelo WhatsApp"),
    );
  }

  // ------------------------------------------------------------ participantes

  function chipDeEnvio(p) {
    if (!sorteado()) return null;
    if (p.email_enviado_em) return h("span", { class: "chip ok" }, "✓ e-mail enviado");
    if (p.erro_envio) return h("span", { class: "chip erro", title: p.erro_envio }, `✗ não enviado: ${p.erro_envio}`);
    return h("span", { class: "chip aguardando" }, "⏳ e-mail ainda não enviado");
  }

  function formEmail(p) {
    const entrada = h("input", {
      id: "email-edicao",
      type: "email",
      inputmode: "email",
      autocomplete: "off",
      "aria-label": `E-mail de ${p.nome}`,
      value: p.email ?? "",
    });
    const erro = h("p", { class: "msg erro", role: "alert" });
    const salvar = h("button", { type: "submit", class: "botao mini" }, "Salvar");
    queueMicrotask(() => entrada.focus());
    return h(
      "form",
      {
        class: "form-email",
        onsubmit: (e) => {
          e.preventDefault();
          if (!emailValido(entrada.value)) {
            erro.textContent = "Esse e-mail não parece válido.";
            return;
          }
          comTrava(salvar, async () => {
            try {
              await api.atualizarEmail(p.id, normalizarEmail(entrada.value));
              editandoEmail = null;
              aviso(`E-mail de ${p.nome} salvo.`, "ok");
              await carregar(false);
            } catch (er) {
              avisarErro(ctx, er);
            }
          });
        },
      },
      h("strong", { class: "p-nome" }, p.nome),
      entrada,
      erro,
      h("div", { class: "p-acoes" }, salvar, h("button", { type: "button", class: "botao mini secundario", onclick: () => { editandoEmail = null; desenhar(); } }, "Cancelar")),
    );
  }

  async function apagarEmail(p, botao) {
    await comTrava(botao, async () => {
      try {
        await api.atualizarEmail(p.id, null);
        aviso(`E-mail de ${p.nome} apagado. Ela(e) pode digitar de novo pelo link.`, "ok");
        await carregar(false);
      } catch (e) {
        avisarErro(ctx, e);
      }
    });
  }

  async function remover(p) {
    const sim = await confirmar({
      titulo: `Remover ${p.nome}?`,
      texto: "Essa pessoa sai da lista e não entra no sorteio.",
      rotulo: "Remover",
      perigo: true,
    });
    if (!sim) return;
    try {
      await api.removerParticipante(p.id);
      await carregar(false);
    } catch (e) {
      avisarErro(ctx, e);
    }
  }

  async function reenviarUm(p, botao) {
    await comTrava(botao, async () => {
      try {
        const r = await api.reenviar(evento.id, p.id);
        if (r.falhas.length > 0) aviso(`Não consegui enviar para ${p.nome}: ${r.falhas[0].erro}`, "erro");
        else aviso(`E-mail reenviado para ${p.nome}.`, "ok");
        await carregar(false);
      } catch (e) {
        avisarErro(ctx, e);
      }
    });
  }

  /** `parecidos`: Map(id -> nomes de quem tem e-mail igual ou parecido), de emailsParecidos(). */
  function linha(p, parecidos) {
    if (editandoEmail === p.id) return h("li", { class: "participante editando" }, formEmail(p));
    const outros = parecidos.get(p.id);
    return h(
      "li",
      { class: "participante" },
      h(
        "div",
        { class: "p-info" },
        h("span", { class: "p-nome" }, p.nome),
        p.email ? h("span", { class: "p-email" }, p.email) : h("span", { class: "chip aguardando" }, "aguardando e-mail"),
        outros
          ? h("span", { class: "chip aguardando", title: "Tudo bem se for de propósito (ex.: pai e filho). Se não, quem receber vai ver o resultado dos dois." }, `⚠ e-mail igual ou parecido com o de ${outros.join(", ")}`)
          : null,
        chipDeEnvio(p),
      ),
      // Depois do sorteio a lista e os e-mails ficam travados (o banco também recusa): só dá para reenviar.
      h(
        "div",
        { class: "p-acoes" },
        !sorteado() ? h("button", { class: "botao mini secundario", onclick: () => { editandoEmail = p.id; desenhar(); } }, p.email ? "Trocar e-mail" : "Definir e-mail") : null,
        !sorteado() && p.email ? h("button", { class: "botao mini secundario", onclick: (e) => apagarEmail(p, e.currentTarget) }, "Apagar e-mail") : null,
        !sorteado() ? h("button", { class: "botao mini perigo", onclick: () => remover(p) }, "Remover") : null,
        sorteado() && p.email ? h("button", { class: "botao mini secundario", onclick: (e) => reenviarUm(p, e.currentTarget) }, "Reenviar") : null,
      ),
    );
  }

  function formAdicionar() {
    const area = h("textarea", {
      id: "novos-nomes",
      rows: 3,
      placeholder: "Um nome por linha, por exemplo:\nAna\nBruno\nCarla",
      "aria-label": "Nomes dos novos participantes",
      oninput: (e) => { rascunhoNomes = e.target.value; },
    });
    area.value = rascunhoNomes;
    const mensagem = h("p", { class: "msg", role: "alert" });
    const botao = h("button", { type: "submit", class: "botao" }, "Adicionar");
    return h(
      "form",
      {
        class: "form-adicionar",
        onsubmit: (e) => {
          e.preventDefault();
          mensagem.textContent = "";
          const { nomes, repetidos, longos } = separarNomes(area.value, evento.participantes.map((p) => p.nome));
          if (longos.length > 0) {
            mensagem.textContent = "Nome muito comprido (máximo 60 letras): " + longos[0].slice(0, 30) + "…";
            mensagem.className = "msg erro";
            return;
          }
          if (nomes.length === 0) {
            mensagem.textContent = repetidos.length > 0 ? "Esses nomes já estão na lista." : "Digite pelo menos um nome.";
            mensagem.className = "msg erro";
            return;
          }
          if (evento.participantes.length + nomes.length > MAXIMO_PARTICIPANTES) {
            mensagem.textContent = `Cada evento aceita até ${MAXIMO_PARTICIPANTES} participantes.`;
            mensagem.className = "msg erro";
            return;
          }
          comTrava(botao, async () => {
            try {
              await api.adicionarParticipantes(evento.id, nomes);
              rascunhoNomes = "";
              aviso(
                `${nomes.length} ${plural(nomes.length, "pessoa adicionada", "pessoas adicionadas")}` +
                  (repetidos.length > 0 ? ` (ignorei ${repetidos.length} ${plural(repetidos.length, "repetida", "repetidas")}).` : "."),
                "ok",
              );
              await carregar(false);
            } catch (er) {
              avisarErro(ctx, er);
            }
          });
        },
      },
      h("label", { for: "novos-nomes" }, "Adicionar pessoas (um nome por linha)"),
      area,
      mensagem,
      botao,
    );
  }

  function secaoParticipantes() {
    const lista = evento.participantes;
    const parecidos = emailsParecidos(lista);
    return h(
      "section",
      { class: "cartao" },
      h("h2", {}, "Participantes ", h("span", { class: "contagem" }, String(lista.length))),
      lista.length > 0
        ? h("ul", { class: "lista-participantes" }, lista.map((p) => linha(p, parecidos)))
        : h("p", { class: "suave" }, "Ninguém ainda. Adicione os nomes abaixo."),
      sorteado()
        ? h("p", { class: "dica" }, 'O sorteio já foi feito, então a lista e os e-mails ficam travados (assim ninguém consegue desviar o resultado de outra pessoa). Para mudar algo, cancele o sorteio em "Opções avançadas" e sorteie de novo.')
        : formAdicionar(),
    );
  }

  // ------------------------------------------------------------ sorteio

  async function executarSorteio() {
    ocupado = "Sorteando e enviando e-mails…";
    desenhar();
    try {
      const r = await api.sortear(evento.id);
      if (r.interrompido) aviso("O sorteio foi alterado enquanto os e-mails saíam. Confira a lista.", "erro");
      else if (r.falhas.length === 0) aviso(`Sorteio feito! ${r.enviados} ${plural(r.enviados, "e-mail enviado", "e-mails enviados")}.`, "ok");
      else aviso(`Sorteio feito, mas ${r.falhas.length} ${plural(r.falhas.length, "e-mail não saiu", "e-mails não saíram")}. Veja o motivo na lista e use "Reenviar".`, "erro");
    } catch (e) {
      avisarErro(ctx, e);
    } finally {
      ocupado = null;
      await carregar(false);
    }
  }

  async function sortear() {
    const n = evento.participantes.length;
    const sim = await confirmar({
      titulo: "Sortear agora?",
      texto: `Vou sortear e mandar um e-mail para cada um dos ${n} participantes. Ninguém, nem você, vê aqui quem tirou quem. Depois do sorteio a lista de participantes e os e-mails não podem mais mudar.`,
      rotulo: "Sortear e enviar e-mails",
    });
    if (sim) await executarSorteio();
  }

  /** "Refazer" = cancelar o sorteio (apaga os pares e libera a lista). Sortear de novo é um passo à parte. */
  async function refazer() {
    const n = evento.participantes.length;
    const sim = await confirmar({
      titulo: "Cancelar o sorteio e refazer?",
      texto: `O sorteio atual deixa de valer e a lista é liberada para você corrigir nomes e e-mails. Depois você sorteia de novo e cada um dos ${n} participantes recebe um e-mail novo avisando que o resultado anterior não vale mais.`,
      rotulo: "Cancelar o sorteio",
      perigo: true,
    });
    if (!sim) return;
    try {
      await api.reabrirSorteio(evento.id);
      aviso("Sorteio cancelado. Corrija o que precisar e sorteie de novo.", "ok");
    } catch (e) {
      avisarErro(ctx, e);
    } finally {
      await carregar(false);
    }
  }

  async function reenviarPendentes(botao) {
    await comTrava(botao, async () => {
      ocupado = "Reenviando e-mails…";
      desenhar();
      try {
        const r = await api.reenviar(evento.id);
        if (r.falhas.length === 0) aviso(`${r.enviados} ${plural(r.enviados, "e-mail enviado", "e-mails enviados")}.`, "ok");
        else aviso(`${r.falhas.length} ${plural(r.falhas.length, "e-mail continua sem sair", "e-mails continuam sem sair")}. Veja o motivo na lista.`, "erro");
      } catch (e) {
        avisarErro(ctx, e);
      } finally {
        ocupado = null;
        await carregar(false);
      }
    });
  }

  function secaoSorteio() {
    const lista = evento.participantes;

    if (!sorteado()) {
      const faltam = lista.filter((p) => !p.email).map((p) => p.nome);
      let texto;
      let pode = false;
      if (lista.length < 3) texto = `Cadastre pelo menos 3 pessoas para sortear (agora ${plural(lista.length, "há 1", `há ${lista.length}`)}).`;
      else if (faltam.length > 0) texto = `Faltam os e-mails de: ${faltam.join(", ")}.`;
      else {
        texto = `Tudo pronto! Os ${lista.length} participantes já têm e-mail.`;
        pode = true;
      }
      const grupos = emailsParecidos(lista);
      const nomesParecidos = lista.filter((p) => grupos.has(p.id)).map((p) => p.nome);
      return h(
        "section",
        { class: "cartao destaque", "aria-busy": ocupado ? "true" : null },
        h("h2", {}, "Sorteio"),
        evento.sorteio_numero > 0
          ? h("p", { class: "alerta" }, `O sorteio anterior foi cancelado. Quem já recebeu um resultado vai receber um e-mail novo avisando que ele não vale mais (sorteio nº ${evento.sorteio_numero + 1}).`)
          : null,
        h("p", { class: pode ? "sucesso" : "" }, texto),
        nomesParecidos.length > 0
          ? h("p", { class: "alerta" }, `Confira antes de sortear: ${nomesParecidos.join(", ")} têm e-mail igual ou parecido. Tudo bem se for de propósito (ex.: pai e filho); se não, quem receber vai ver o resultado de mais de uma pessoa.`)
          : null,
        lista.length === 3
          ? h("p", { class: "dica" }, "Com só 3 pessoas, quem sabe quem tirou consegue deduzir o sorteio inteiro. Funciona, mas o segredo é menor.")
          : null,
        h("button", { class: "botao grande", disabled: !pode || ocupado !== null, onclick: sortear }, ocupado ?? "Sortear e enviar e-mails"),
        ocupado ? h("p", { class: "dica", role: "status" }, "Isso pode levar até um minuto. Não feche a página.") : null,
        h("p", { class: "dica" }, "O sorteio é feito no servidor e cada pessoa recebe só o próprio resultado, por e-mail. Ninguém, nem você, vê quem tirou quem."),
        h("p", { class: "dica" }, "Ainda não testou o envio de e-mail? ", h("a", { href: "#/diagnostico" }, "Faça o teste antes de sortear"), "."),
      );
    }

    const enviados = lista.filter((p) => p.email_enviado_em).length;
    const pendentes = lista.length - enviados;
    return h(
      "section",
      { class: "cartao destaque", "aria-busy": ocupado ? "true" : null },
      h("h2", {}, "Sorteio feito ✓"),
      h("p", {}, `${evento.sorteio_numero > 1 ? `Sorteio nº ${evento.sorteio_numero}` : "Sorteio"} feito em ${dataHora(evento.sorteado_em)}.`),
      pendentes === 0
        ? h("p", { class: "sucesso" }, `Todos os ${lista.length} e-mails foram enviados. Peça para olharem também a pasta de spam.`)
        : [
            h("p", { class: "alerta" }, `${pendentes} ${plural(pendentes, "e-mail ainda não saiu", "e-mails ainda não saíram")}. O motivo aparece ao lado de cada nome, na lista.`),
            h("button", { class: "botao", disabled: ocupado !== null, onclick: (e) => reenviarPendentes(e.currentTarget) }, ocupado ?? "Reenviar os pendentes"),
          ],
      h(
        "details",
        { class: "avancado" },
        h("summary", {}, "Opções avançadas"),
        h("p", { class: "dica" }, "Errou o e-mail de alguém ou esqueceu uma pessoa? Cancele este sorteio: a lista é liberada para você corrigir, e quando você sortear de novo todo mundo recebe um e-mail novo avisando que o anterior não vale mais."),
        h("button", { class: "botao perigo mini", disabled: ocupado !== null, onclick: refazer }, "Cancelar este sorteio e refazer"),
      ),
    );
  }

  // ------------------------------------------------------------ apagar

  async function apagar() {
    const sim = await confirmar({
      titulo: "Apagar este evento?",
      texto: `"${evento.nome}", os participantes e os e-mails cadastrados serão apagados para sempre. Os e-mails que já foram enviados continuam nas caixas de entrada de cada um.`,
      rotulo: "Apagar evento",
      perigo: true,
    });
    if (!sim) return;
    try {
      await api.apagarEvento(evento.id);
      aviso("Evento apagado.", "ok");
      ir("#/eventos");
    } catch (e) {
      avisarErro(ctx, e);
    }
  }

  function secaoApagar() {
    return h(
      "section",
      { class: "cartao zona-perigo" },
      h("h2", {}, "Apagar evento"),
      h("p", { class: "suave" }, "Remove o evento, os participantes e os e-mails guardados. Use depois que a troca de presentes acabar."),
      h("button", { class: "botao perigo mini", onclick: apagar }, "Apagar este evento"),
    );
  }

  carregar();
  return raiz;
}
