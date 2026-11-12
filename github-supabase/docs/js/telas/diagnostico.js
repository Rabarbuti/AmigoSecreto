// "Testar a conexão": confere, passo a passo, se o site, o banco, o login e o envio de e-mail
// estão funcionando. Serve para achar rápido o que faltou na configuração.

import { h, trocarConteudo, definirTitulo, aviso, comTrava } from "../ui.js";
import { traduzirErro } from "../erros.js";

const ICONE = { ok: "✅", aviso: "⚠️", erro: "❌", pendente: "⏳", info: "ℹ️" };

export function telaDiagnostico(ctx) {
  const { api } = ctx;
  definirTitulo("Testar a conexão");

  const raiz = h("div", { class: "tela tela-estreita" });
  let passos = [];
  let podeTestarEmail = false;
  let resultadoEmail = null;

  const passo = (estado, titulo, detalhe) => ({ estado, titulo, detalhe });

  async function rodar() {
    podeTestarEmail = false;
    passos = [];
    desenhar(true);

    // 1. configuração
    if (api.modo === "demo") {
      // sem Supabase não há banco, login nem função para testar
      passos.push(passo("aviso", "Modo demonstração", "O site ainda não está ligado a um projeto do Supabase (veja o config.js e o README, passo 6). Os dados são fictícios e nenhum e-mail é enviado, então não há banco nem função para testar."));
      desenhar(false);
      return;
    }
    passos.push(passo("ok", "Configuração do site", `Endereço do Supabase: ${new URL(api.infoConexao().url).host}`));
    desenhar(true);

    // 2. banco
    try {
      const versao = await api.versaoDoEsquema();
      passos.push(passo("ok", "Banco de dados", `O banco respondeu e tem as tabelas e funções do site (versão ${versao}).`));
    } catch (e) {
      passos.push(passo("erro", "Banco de dados", traduzirErro(e).message));
    }
    desenhar(true);

    // 3. cadastro de novos usuários (precisa estar desligado)
    const cadastro = await api.configuracaoDeLogin();
    if (!cadastro) {
      passos.push(passo("info", "Cadastro de novos usuários", "Não consegui conferir se o cadastro está desligado. Confira no painel do Supabase (README, passo 3)."));
    } else if (!cadastro.cadastroAberto) {
      passos.push(passo("ok", "Cadastro de novos usuários", "Desligado: só entra quem você criou no painel do Supabase."));
    } else if (cadastro.confirmacaoAutomatica) {
      passos.push(passo("erro", "Cadastro de novos usuários", 'LIGADO e sem confirmação por e-mail: qualquer pessoa pode criar uma conta e usar o envio de e-mail do seu Gmail. Desligue "Allow new users to sign up" no painel do Supabase (README, passo 3).'));
    } else {
      passos.push(passo("aviso", "Cadastro de novos usuários", 'Ligado. Mesmo que hoje isso não deixe ninguém entrar, é mais seguro desligar "Allow new users to sign up" no painel do Supabase (README, passo 3).'));
    }
    desenhar(true);

    // 4. login
    let sessao = null;
    try {
      sessao = await api.sessaoAtual();
    } catch {
      sessao = null;
    }
    if (sessao) passos.push(passo("ok", "Login", `Você está logado como ${sessao.email}.`));
    else passos.push(passo("info", "Login", "Você não está logado. Entre como organizador para testar também a função de sorteio e o envio de e-mail."));
    desenhar(true);

    // 5. função de sorteio + e-mail
    if (sessao) {
      try {
        const r = await api.diagnosticoFuncao();
        if (r.correio) {
          const cota = typeof r.cota === "number" ? ` O Gmail ainda deixa mandar ${r.cota} e-mails hoje.` : "";
          passos.push(passo("ok", "Função de sorteio e envio de e-mail", `A função está no ar e os segredos do e-mail estão configurados.${cota}`));
          podeTestarEmail = true;
        } else if (r.problema) {
          passos.push(passo("erro", "Função de sorteio e envio de e-mail", `A função está no ar, mas o envio de e-mail está mal configurado: ${r.problema}`));
        } else {
          passos.push(passo("aviso", "Função de sorteio e envio de e-mail", "A função está no ar, mas faltam os segredos APPS_SCRIPT_URL e APPS_SCRIPT_SEGREDO (README, passo 5)."));
        }
      } catch (e) {
        passos.push(passo("erro", "Função de sorteio e envio de e-mail", traduzirErro(e).message));
      }
    }
    desenhar(false);
  }

  async function testarEmail(botao) {
    await comTrava(botao, async () => {
      resultadoEmail = passo("pendente", "E-mail de teste", "Enviando…");
      desenhar(false);
      try {
        const r = await api.testarEmail();
        resultadoEmail = passo("ok", "E-mail de teste", `Enviado para ${r.enviado_para}. Confira a caixa de entrada (e o spam).`);
        aviso("E-mail de teste enviado!", "ok");
      } catch (e) {
        resultadoEmail = passo("erro", "E-mail de teste", traduzirErro(e).message);
      }
      desenhar(false);
    });
  }

  function itemDe(p) {
    return h(
      "li",
      { class: `diag diag-${p.estado}` },
      h("span", { class: "diag-icone", "aria-hidden": "true" }, ICONE[p.estado]),
      h("div", {}, h("strong", {}, p.titulo), h("p", { class: "suave" }, p.detalhe)),
    );
  }

  function desenhar(rodando) {
    const itens = [...passos, resultadoEmail].filter(Boolean);
    trocarConteudo(
      raiz,
      h(
        "section",
        { class: "cartao" },
        h("a", { class: "voltar", href: "#/" }, "← Voltar"),
        h("h1", {}, "Testar a conexão"),
        h("ul", { class: "lista-diag", "aria-busy": rodando ? "true" : null }, itens.map(itemDe)),
        rodando ? h("p", { class: "dica", role: "status" }, "Testando…") : null,
        h(
          "div",
          { class: "linha-botoes" },
          podeTestarEmail ? h("button", { class: "botao", onclick: (e) => testarEmail(e.currentTarget) }, "Enviar e-mail de teste para mim") : null,
          h("button", { class: "botao secundario", onclick: rodar }, "Testar de novo"),
        ),
      ),
    );
  }

  rodar();
  return raiz;
}
