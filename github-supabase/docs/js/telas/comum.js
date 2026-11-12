// Peças que mais de uma tela usa.

import { h, abrirDialogo, aviso, mostrarErro } from "../ui.js";
import { traduzirErro } from "../erros.js";
import { valorDoTexto, valorParaCampo } from "../formatar.js";

/** Erro ao CARREGAR uma tela: sessão vencida volta para o login; o resto mostra a mensagem. */
export function tratarErro(ctx, erro, raiz, tentarDeNovo) {
  const e = traduzirErro(erro);
  if (e.codigo === "sessao") {
    aviso("Sua sessão expirou. Entre de novo.", "erro");
    ctx.ir("#/entrar");
    return;
  }
  if (e.codigo === "nao_encontrado") {
    // tentar de novo não adianta: só oferece o caminho de volta
    mostrarErro(raiz, e, null, { texto: "Voltar para meus eventos", href: "#/eventos" });
    return;
  }
  mostrarErro(raiz, e, tentarDeNovo);
}

/** Erro ao fazer uma AÇÃO (clicar num botão): aparece como aviso na tela. */
export function avisarErro(ctx, erro) {
  const e = traduzirErro(erro);
  if (e.codigo === "sessao") {
    aviso("Sua sessão expirou. Entre de novo.", "erro");
    ctx.ir("#/entrar");
    return;
  }
  aviso(e.message, "erro");
}

/** <div class="campo"><label>…</label>{input}<p class="dica">…</p></div> (o input precisa ter id) */
export function campo(rotulo, entrada, dica) {
  return h(
    "div",
    { class: "campo" },
    h("label", { for: entrada.id }, rotulo),
    entrada,
    dica ? h("p", { class: "dica" }, dica) : null,
  );
}

/**
 * Janela com o formulário do evento (criar ou editar).
 * Devolve os dados { nome, data_evento, valor, recado } ou null se a pessoa cancelar.
 */
export function formularioEvento({ titulo, rotulo, valores = {} }) {
  return new Promise((resolver) => {
    let resolvido = false;
    const terminar = (resultado) => {
      if (resolvido) return;
      resolvido = true;
      resolver(resultado);
    };

    const nome = h("input", { id: "ev-nome", type: "text", maxlength: 80, autocomplete: "off", value: valores.nome ?? "" });
    const data = h("input", { id: "ev-data", type: "date", value: valores.data_evento ?? "" });
    const valor = h("input", {
      id: "ev-valor",
      type: "text",
      inputmode: "decimal",
      autocomplete: "off",
      placeholder: "ex.: 50,00",
      value: valores.valor != null ? valorParaCampo(valores.valor) : "",
    });
    const recado = h("textarea", {
      id: "ev-recado",
      rows: 2,
      maxlength: 280,
      placeholder: "ex.: Troca na casa da vovó, depois do almoço",
    });
    recado.value = valores.recado ?? "";
    const erro = h("p", { class: "msg erro", role: "alert" });

    const form = h(
      "form",
      {
        novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          const nomeLimpo = nome.value.replace(/\s+/g, " ").trim();
          const valorNumero = valorDoTexto(valor.value);
          let problema = null;
          let foco = null;
          if (!nomeLimpo) [problema, foco] = ["Dê um nome ao evento.", nome];
          else if (!/^\d{4}-\d{2}-\d{2}$/.test(data.value)) [problema, foco] = ["Escolha a data do evento.", data];
          else if (!Number.isFinite(valorNumero) || valorNumero < 0 || valorNumero > 100000) {
            [problema, foco] = ["Digite o valor do presente, por exemplo 50,00 (use 0 se não houver valor combinado).", valor];
          }
          if (problema) {
            erro.textContent = problema;
            foco.focus();
            return;
          }
          terminar({ nome: nomeLimpo, data_evento: data.value, valor: valorNumero, recado: recado.value.replace(/\s+/g, " ").trim() });
          fechar();
        },
      },
      campo("Nome do evento", nome),
      campo("Data", data, "O dia da festa ou da troca de presentes."),
      campo("Valor do presente (R$)", valor, "Use 0 se não houver valor combinado."),
      campo("Recado para os participantes (opcional)", recado, "Aparece na página do link e no e-mail do sorteio."),
      erro,
      h(
        "div",
        { class: "dialogo-acoes" },
        h("button", { type: "button", class: "botao secundario", onclick: () => { terminar(null); fechar(); } }, "Cancelar"),
        h("button", { type: "submit", class: "botao" }, rotulo),
      ),
    );

    const { fechar } = abrirDialogo(titulo, form, () => terminar(null));
    nome.focus();
  });
}
