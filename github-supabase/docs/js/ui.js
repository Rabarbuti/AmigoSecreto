// Ferramentas para montar a página. Nada aqui usa innerHTML: todo texto vira texto, então
// um nome como "<img onerror=...>" aparece literalmente na tela e não executa nada.

const URL_SEGURA = /^(#|https?:\/\/|mailto:)/i;

/**
 * h("div", { class: "x", onclick: fn }, "texto", outroNo, [lista...]) -> elemento
 * Atributos "on..." viram ouvintes de evento. href/src só aceitam endereços seguros.
 */
export function h(tag, atributos, ...filhos) {
  const no = document.createElement(tag);
  let valor;
  for (const [nome, conteudo] of Object.entries(atributos ?? {})) {
    if (conteudo === false || conteudo == null) continue;
    if (nome === "class") no.className = conteudo;
    else if (nome.startsWith("on") && typeof conteudo === "function") no.addEventListener(nome.slice(2), conteudo);
    else if (nome === "href" || nome === "src") {
      if (URL_SEGURA.test(String(conteudo))) no.setAttribute(nome, conteudo);
    } else if (nome === "value") valor = conteudo; // depois dos filhos (serve para <select>)
    else if (nome === "checked" || nome === "disabled" || nome === "selected") no[nome] = Boolean(conteudo);
    else no.setAttribute(nome, conteudo === true ? "" : String(conteudo));
  }
  for (const filho of filhos.flat(Infinity)) {
    if (filho == null || filho === false) continue;
    no.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
  }
  if (valor !== undefined) no.value = valor;
  return no;
}

/** Esvazia o elemento e coloca os filhos novos. */
export function trocarConteudo(pai, ...filhos) {
  pai.replaceChildren();
  for (const filho of filhos.flat(Infinity)) {
    if (filho == null || filho === false) continue;
    pai.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
  }
}

export function definirTitulo(titulo) {
  document.title = titulo ? `${titulo} · Amigo Secreto` : "Amigo Secreto";
}

// ---------------------------------------------------------------- avisos (toasts)

export function aviso(texto, tipo = "info") {
  const lugar = document.getElementById("avisos");
  if (!lugar) return;
  const no = h("div", { class: `aviso aviso-${tipo}` }, texto);
  lugar.append(no);
  setTimeout(() => no.remove(), tipo === "erro" ? 9000 : 5000);
}

// ---------------------------------------------------------------- diálogos

/** Abre um <dialog> modal com o conteúdo dado. Devolve { dialogo, fechar }. */
export function abrirDialogo(titulo, conteudo, aoFechar) {
  const dialogo = h("dialog", { class: "dialogo", "aria-label": titulo });
  const fechar = () => {
    if (dialogo.open) dialogo.close();
    dialogo.remove();
    aoFechar?.();
  };
  dialogo.addEventListener("cancel", (e) => {
    e.preventDefault();
    fechar();
  });
  dialogo.append(h("h2", {}, titulo), conteudo);
  document.body.append(dialogo);
  dialogo.showModal();
  return { dialogo, fechar };
}

/** Pergunta "tem certeza?" e devolve true/false. */
export function confirmar({ titulo, texto, rotulo = "Confirmar", perigo = false }) {
  return new Promise((resolver) => {
    let resolvido = false;
    const terminar = (resposta) => {
      if (resolvido) return;
      resolvido = true;
      resolver(resposta);
    };
    const corpo = h(
      "form",
      {
        onsubmit: (e) => {
          e.preventDefault();
          terminar(true);
          fechar();
        },
      },
      h("p", { class: "dialogo-texto" }, texto),
      h(
        "div",
        { class: "dialogo-acoes" },
        h("button", { type: "button", class: "botao secundario", autofocus: perigo, onclick: () => { terminar(false); fechar(); } }, "Cancelar"),
        h("button", { type: "submit", class: perigo ? "botao perigo" : "botao" }, rotulo),
      ),
    );
    const { fechar } = abrirDialogo(titulo, corpo, () => terminar(false));
  });
}

// ---------------------------------------------------------------- pequenos blocos

export function carregando(texto = "Carregando…") {
  return h("p", { class: "carregando", role: "status" }, texto);
}

/**
 * Mostra um erro dentro de `pai`, com um botão opcional para tentar de novo e/ou um link
 * para sair dali ({ texto, href }).
 */
export function mostrarErro(pai, erro, tentarDeNovo, voltar) {
  trocarConteudo(
    pai,
    h(
      "div",
      { class: "cartao erro-bloco", role: "alert" },
      h("h2", {}, "Ops, algo não deu certo"),
      h("p", {}, erro?.message ?? String(erro)),
      h(
        "div",
        { class: "linha-botoes" },
        tentarDeNovo ? h("button", { class: "botao secundario", onclick: tentarDeNovo }, "Tentar de novo") : null,
        voltar ? h("a", { class: "botao secundario", href: voltar.href }, voltar.texto) : null,
      ),
    ),
  );
}

export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // sem permissão do navegador: cai para o jeito antigo
  }
  const area = h("textarea", { class: "fora-da-tela", readonly: true, "aria-hidden": "true" });
  area.value = texto;
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/** Desativa um botão enquanto a ação roda, para não dar duplo clique. */
export async function comTrava(botao, acao) {
  if (botao.disabled) return;
  botao.disabled = true;
  botao.setAttribute("aria-busy", "true");
  try {
    return await acao();
  } finally {
    botao.disabled = false;
    botao.removeAttribute("aria-busy");
  }
}
