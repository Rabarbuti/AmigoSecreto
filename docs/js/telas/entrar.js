// Tela de entrada do organizador (e-mail e senha criados no painel do Supabase).

import { h, comTrava, definirTitulo } from "../ui.js";
import { temporario } from "../armazenamento.js";
import { traduzirErro } from "../erros.js";
import { campo } from "./comum.js";

export function telaEntrar(ctx) {
  const { api, ir } = ctx;
  definirTitulo("Entrar");

  const email = h("input", { id: "login-email", type: "email", autocomplete: "username", inputmode: "email", required: true });
  const senha = h("input", { id: "login-senha", type: "password", autocomplete: "current-password", required: true });
  const mensagem = h("p", { class: "msg", role: "alert" });
  const botao = h("button", { type: "submit", class: "botao grande" }, "Entrar");

  const form = h(
    "form",
    {
      class: "cartao",
      onsubmit: (e) => {
        e.preventDefault();
        mensagem.textContent = "";
        comTrava(botao, async () => {
          try {
            await api.entrar(email.value, senha.value);
            const destino = temporario.ler("amigo-secreto.voltar") || "#/eventos";
            temporario.apagar("amigo-secreto.voltar");
            ir(destino);
          } catch (erro) {
            mensagem.textContent = traduzirErro(erro).message;
            mensagem.className = "msg erro";
          }
        });
      },
    },
    h("h1", {}, "Entrar"),
    h("p", { class: "suave" }, "Área de quem organiza o amigo secreto."),
    campo("E-mail", email),
    campo("Senha", senha),
    mensagem,
    botao,
  );

  const demo =
    api.modo === "demo"
      ? h("p", { class: "dica centro" }, "Modo demonstração: pode digitar qualquer e-mail e senha para entrar.")
      : null;

  return h(
    "div",
    { class: "tela tela-estreita" },
    h("div", { class: "apresentacao" }, h("div", { class: "laco", "aria-hidden": "true" }, "🎁"), h("p", { class: "suave" }, "Cadastre os participantes, mande um link e sorteie: cada um recebe por e-mail quem tirou.")),
    form,
    demo,
    h(
      "p",
      { class: "dica centro" },
      "Recebeu um link de amigo secreto? Abra o link que o organizador mandou, não precisa entrar aqui. ",
      h("a", { href: "#/diagnostico" }, "Testar a conexão"),
    ),
  );
}
