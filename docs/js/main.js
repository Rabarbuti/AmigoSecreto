// Ponto de partida: lê a configuração, escolhe a API (Supabase de verdade ou demonstração)
// e cuida das rotas (o endereço depois do "#").

import { h, trocarConteudo, definirTitulo, aviso } from "./ui.js";
import { criarApiSupabase } from "./api.js";
import { criarApiDemo } from "./api-demo.js";
import { tipoDeChave } from "./formatar.js";
import { temporario } from "./armazenamento.js";
import { telaEntrar } from "./telas/entrar.js";
import { telaEventos } from "./telas/eventos.js";
import { telaEvento } from "./telas/evento.js";
import { telaParticipar } from "./telas/participar.js";
import { telaDiagnostico } from "./telas/diagnostico.js";

const app = document.getElementById("app");
const menu = document.getElementById("menu");

/** O Pages não manda cabeçalho anti-iframe: se alguém embutir o site noutra página (para enganar cliques), não roda. */
const emIframe = (() => {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
})();

/** decodeURIComponent que não quebra com "%" solto no endereço. */
function decodificar(texto) {
  try {
    return decodeURIComponent(texto);
  } catch {
    return texto;
  }
}

/** config.js (público) + config.local.js (só no seu computador, ignorado pelo git). */
async function lerConfig() {
  let config = { ...(window.AMIGO_SECRETO_CONFIG ?? {}) };
  if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
    try {
      const local = await import("../config.local.js");
      config = { ...config, ...local.default };
    } catch {
      // não existe config.local.js: tudo bem
    }
  }
  return config;
}

function configCompleta(config) {
  return (
    typeof config.supabaseUrl === "string" &&
    /^https?:\/\/[^\s]+$/.test(config.supabaseUrl) &&
    !/SEU-PROJETO/i.test(config.supabaseUrl) &&
    typeof config.supabaseKey === "string" &&
    config.supabaseKey.length > 20 &&
    !/COLE_AQUI/i.test(config.supabaseKey)
  );
}

function telaChaveSecreta() {
  definirTitulo("Configuração insegura");
  return h(
    "div",
    { class: "tela tela-estreita" },
    h(
      "section",
      { class: "cartao erro-bloco", role: "alert" },
      h("h1", {}, "Chave secreta no config.js!"),
      h("p", {}, "O arquivo config.js é PÚBLICO: qualquer pessoa que abrir o site consegue ler o que está nele. Mas a chave que está aí é a chave SECRETA do Supabase, que dá acesso total ao seu banco."),
      h("p", {}, "Por segurança, o site não vai funcionar assim. O que fazer:"),
      h(
        "ol",
        {},
        h("li", {}, "Tire a chave secreta do config.js e coloque no lugar a chave publicável (começa com sb_publishable_)."),
        h("li", {}, "Se o config.js com a chave secreta já foi para o GitHub, considere a chave perdida: no painel do Supabase, em Settings > API Keys, apague essa chave secreta e crie outra."),
      ),
    ),
  );
}

async function iniciar() {
  if (emIframe) {
    trocarConteudo(app, h("div", { class: "tela tela-estreita" }, h("div", { class: "cartao centro" }, h("h1", {}, "Abra o site direto"), h("p", {}, "Por segurança, este site não funciona dentro de outra página. Abra o endereço dele direto no navegador."))));
    return;
  }
  const config = await lerConfig();
  const forcarDemo = new URLSearchParams(location.search).has("demo");

  if (!forcarDemo && tipoDeChave(config.supabaseKey) === "secreta") {
    trocarConteudo(app, telaChaveSecreta());
    return;
  }

  const demo = forcarDemo || !configCompleta(config);
  const api = demo ? criarApiDemo() : criarApiSupabase(config);
  if (demo) document.getElementById("faixa-demo").hidden = false;

  const ctx = {
    api,
    sessao: null,
    ir(destino) {
      if (location.hash === destino) rotear();
      else location.hash = destino;
    },
  };

  // ---------------------------------------------------------------- menu
  const marca = document.querySelector(".marca");
  function desenharMenu(sessao, hash) {
    const publica = /^#\/e\//.test(hash);
    // na página do link o logo não leva a lugar nenhum (quem chegou ali não é organizador)
    if (publica) marca.removeAttribute("href");
    else marca.setAttribute("href", "#/");
    trocarConteudo(
      menu,
      sessao && !publica
        ? [
            h("a", { href: "#/eventos" }, "Meus eventos"),
            h("span", { class: "menu-email" }, sessao.email),
            h(
              "button",
              {
                class: "botao mini secundario",
                onclick: async () => {
                  await api.sair();
                  ctx.ir("#/entrar");
                },
              },
              "Sair",
            ),
          ]
        : null,
    );
  }

  // ---------------------------------------------------------------- rotas
  const rotas = [
    { padrao: /^(#\/?)?$/, exige: false, tela: (c) => (c.sessao ? c.ir("#/eventos") : telaEntrar(c)) },
    { padrao: /^#\/entrar$/, exige: false, tela: (c) => (c.sessao ? c.ir("#/eventos") : telaEntrar(c)) },
    { padrao: /^#\/eventos$/, exige: true, tela: (c) => telaEventos(c) },
    { padrao: /^#\/evento\/([^/]+)$/, exige: true, tela: (c, id) => telaEvento(c, decodificar(id)) },
    { padrao: /^#\/e\/([^/]+)$/, exige: false, tela: (c, token) => telaParticipar(c, decodificar(token)) },
    { padrao: /^#\/diagnostico$/, exige: false, tela: (c) => telaDiagnostico(c) },
  ];

  let versao = 0;
  async function rotear() {
    const minha = ++versao;
    const hash = location.hash || "#/";
    let sessao = null;
    try {
      sessao = await api.sessaoAtual();
    } catch {
      sessao = null;
    }
    if (minha !== versao) return; // o usuário já foi para outra página
    ctx.sessao = sessao;
    desenharMenu(sessao, hash);

    for (const rota of rotas) {
      const achou = rota.padrao.exec(hash);
      if (!achou) continue;
      if (rota.exige && !sessao) {
        temporario.gravar("amigo-secreto.voltar", hash);
        ctx.ir("#/entrar");
        return;
      }
      const resultado = rota.tela(ctx, ...achou.slice(1));
      if (resultado instanceof Node) {
        trocarConteudo(app, resultado);
        window.scrollTo(0, 0);
        app.focus({ preventScroll: true });
      }
      return;
    }

    definirTitulo("Página não encontrada");
    trocarConteudo(
      app,
      h("div", { class: "tela tela-estreita" }, h("div", { class: "cartao centro" }, h("h1", {}, "Página não encontrada"), h("p", {}, h("a", { href: "#/" }, "Voltar para o início")))),
    );
  }

  // a sessão vencendo ou saindo em outra aba leva para o login
  api.aoMudarSessao((sessao) => {
    ctx.sessao = sessao;
    if (!sessao && /^#\/(eventos|evento\/)/.test(location.hash)) ctx.ir("#/entrar");
  });

  window.addEventListener("hashchange", rotear);
  await rotear();
}

iniciar().catch((erro) => {
  console.error(erro);
  aviso("O site não conseguiu iniciar. Recarregue a página.", "erro");
});
