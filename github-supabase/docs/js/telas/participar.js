// Página do link (sem login): o participante escolhe o próprio nome e deixa o e-mail.

import { h, trocarConteudo, carregando, definirTitulo, aviso, mostrarErro, comTrava } from "../ui.js";
import { permanente } from "../armazenamento.js";
import { dataLonga, emailValido, moeda, normalizarEmail, plural } from "../formatar.js";
import { ErroApp, traduzirErro } from "../erros.js";
import { campo } from "./comum.js";

const MENSAGENS = {
  ja_confirmado: "Esse nome já tem e-mail cadastrado. Se foi engano, fale com o organizador para ele apagar o e-mail.",
  email_invalido: "Esse e-mail não parece válido. Confira se digitou certo.",
  sorteio_ja_realizado: "O sorteio já foi feito, então não dá mais para cadastrar.",
  participante_nao_encontrado: "Não achei esse nome na lista. Recarregue a página e tente de novo.",
  evento_nao_encontrado: "Esse link não é de nenhum evento. Peça o link de novo para quem organizou.",
};

const chaveLembrada = (token) => `amigo-secreto.confirmado.${token}`;

/** O texto padrão de "sem conexão" fala em restaurar o projeto do Supabase: coisa do organizador, não do participante. */
function mensagemDoErro(e) {
  const erro = traduzirErro(e);
  if (erro.codigo === "rede") {
    return "Não consegui falar com o servidor agora. Tente de novo daqui a pouco; se continuar assim, avise quem organizou o amigo secreto.";
  }
  return erro.message;
}

function lerLembrado(token) {
  try {
    return JSON.parse(permanente.ler(chaveLembrada(token)) ?? "null");
  } catch {
    return null;
  }
}

export function telaParticipar(ctx, token) {
  const { api } = ctx;
  const raiz = h("div", { class: "tela tela-estreita" }, carregando());

  let evento = null;
  let escolhido = null; // { id, nome } de quem clicou no próprio nome
  let concluido = null; // { nome, email } depois de confirmar

  async function carregar() {
    try {
      evento = await api.eventoPublico(token);
    } catch (e) {
      mostrarErro(raiz, new ErroApp(mensagemDoErro(e)), carregar);
      return;
    }
    if (!evento) {
      definirTitulo("Link inválido");
      trocarConteudo(
        raiz,
        h(
          "div",
          { class: "cartao centro" },
          h("div", { class: "laco", "aria-hidden": "true" }, "🔗"),
          h("h1", {}, "Link inválido"),
          h("p", { class: "suave" }, "Não achei esse evento. Confira se o link foi copiado inteiro ou peça o link de novo para quem organizou."),
        ),
      );
      return;
    }
    definirTitulo(evento.nome);
    desenhar();
  }

  function desenhar() {
    const topo = cabecalho();
    if (evento.sorteado) return trocarConteudo(raiz, topo, cartaoSorteado());
    if (concluido) return trocarConteudo(raiz, topo, cartaoPronto());
    if (escolhido) return trocarConteudo(raiz, topo, cartaoEmail());
    trocarConteudo(raiz, topo, lembrete(), cartaoNomes());
  }

  function cabecalho() {
    return h(
      "header",
      { class: "cabecalho-convite" },
      h("div", { class: "laco", "aria-hidden": "true" }, "🎁"),
      h("p", { class: "suave" }, "Amigo secreto"),
      h("h1", {}, evento.nome),
      h("p", { class: "meta" }, `📅 ${dataLonga(evento.data_evento)}`, " · ", `🎁 ${evento.valor > 0 ? `presente de até ${moeda(evento.valor)}` : "valor livre"}`),
      evento.recado ? h("p", { class: "recado" }, evento.recado) : null,
    );
  }

  function cartaoSorteado() {
    return h(
      "section",
      { class: "cartao centro" },
      h("h2", {}, "O sorteio já foi feito! 🎉"),
      h("p", {}, "Cada participante recebeu por e-mail o nome de quem tirou."),
      h("p", { class: "suave" }, "Não encontrou? Olhe a pasta de spam ou de promoções. Se ainda assim não achar, fale com o organizador."),
    );
  }

  /** Aviso de que este aparelho já confirmou um nome (ajuda quem abre o link duas vezes). */
  function lembrete() {
    const lembrado = lerLembrado(token);
    if (!lembrado) return null;
    const p = evento.participantes.find((x) => x.id === lembrado.id);
    if (!p || !p.confirmado) return null;
    return h("p", { class: "lembrete", role: "status" }, "✓ Você já confirmou como ", h("strong", {}, p.nome), " neste aparelho. Agora é só esperar o sorteio.");
  }

  function cartaoNomes() {
    const lista = evento.participantes;
    const prontos = lista.filter((p) => p.confirmado).length;
    return h(
      "section",
      { class: "cartao" },
      h("h2", {}, "Quem é você?"),
      lista.length === 0
        ? h("p", { class: "suave" }, "O organizador ainda não cadastrou os nomes. Volte daqui a pouco.")
        : h(
            "div",
            { class: "nomes" },
            lista.map((p) =>
              h(
                "button",
                {
                  type: "button",
                  class: p.confirmado ? "nome pronto" : "nome",
                  disabled: p.confirmado,
                  onclick: () => {
                    escolhido = { id: p.id, nome: p.nome };
                    desenhar();
                  },
                },
                p.nome,
                p.confirmado ? h("span", { class: "visualmente-oculto" }, " (já cadastrado)") : null,
              ),
            ),
          ),
      lista.length > 0
        ? h("p", { class: "progresso" }, `${prontos} de ${lista.length} ${plural(prontos, "já deixou", "já deixaram")} o e-mail`)
        : null,
    );
  }

  function cartaoEmail() {
    const email = h("input", { id: "p-email", type: "email", autocomplete: "email", inputmode: "email", required: true });
    const email2 = h("input", { id: "p-email2", type: "email", autocomplete: "off", inputmode: "email", required: true });
    const mensagem = h("p", { class: "msg", role: "alert" });
    const botao = h("button", { type: "submit", class: "botao grande" }, "Confirmar");
    queueMicrotask(() => email.focus());

    const erro = (texto) => {
      mensagem.textContent = texto;
      mensagem.className = "msg erro";
    };

    return h(
      "section",
      { class: "cartao" },
      h("h2", {}, `Olá, ${escolhido.nome}!`),
      h("p", { class: "suave" }, "Digite o seu e-mail. Depois que o organizador fizer o sorteio, é lá que você recebe o nome de quem tirou."),
      h(
        "form",
        {
          novalidate: true,
          onsubmit: (e) => {
            e.preventDefault();
            mensagem.textContent = "";
            if (!emailValido(email.value)) return erro("Esse e-mail não parece válido. Confira se digitou certo.");
            if (normalizarEmail(email.value) !== normalizarEmail(email2.value)) return erro("Os dois e-mails não são iguais.");
            comTrava(botao, async () => {
              try {
                const r = await api.confirmarEmail(token, escolhido.id, normalizarEmail(email.value));
                if (r?.ok) {
                  permanente.gravar(chaveLembrada(token), JSON.stringify({ id: escolhido.id, nome: r.nome }));
                  concluido = { nome: r.nome ?? escolhido.nome, email: normalizarEmail(email.value) };
                  escolhido = null;
                  evento = (await api.eventoPublico(token)) ?? evento;
                  desenhar();
                  return;
                }
                const texto = MENSAGENS[r?.erro] ?? "Não consegui salvar. Tente de novo.";
                if (r?.erro === "ja_confirmado" || r?.erro === "sorteio_ja_realizado" || r?.erro === "participante_nao_encontrado") {
                  aviso(texto, "erro");
                  escolhido = null;
                  await carregar();
                  return;
                }
                erro(texto);
              } catch (er) {
                erro(mensagemDoErro(er));
              }
            });
          },
        },
        campo("Seu e-mail", email),
        campo("Repita o e-mail", email2, "Digitamos duas vezes para não errar: é para este endereço que o resultado vai."),
        mensagem,
        botao,
      ),
      h(
        "button",
        {
          type: "button",
          class: "link",
          onclick: () => {
            escolhido = null;
            desenhar();
          },
        },
        "Não sou eu, voltar",
      ),
      h("p", { class: "dica" }, "O seu e-mail serve só para enviar o resultado deste sorteio e só o organizador consegue vê-lo."),
    );
  }

  function cartaoPronto() {
    return h(
      "section",
      { class: "cartao centro" },
      h("div", { class: "laco", "aria-hidden": "true" }, "✅"),
      h("h2", {}, `Tudo certo, ${concluido.nome}!`),
      h("p", {}, `Seu e-mail (${concluido.email}) foi cadastrado.`),
      h("p", { class: "suave" }, "Quando o organizador fizer o sorteio, você recebe por e-mail quem tirou. Olhe também a pasta de spam. Shhh... 🤫"),
      h(
        "button",
        {
          type: "button",
          class: "botao secundario",
          onclick: () => {
            concluido = null;
            desenhar();
          },
        },
        "Voltar para a lista",
      ),
    );
  }

  carregar();
  return raiz;
}
