import { test } from "node:test";
import assert from "node:assert/strict";
import { lerConfiguracaoDeLogin } from "../docs/js/api.js";

test("lerConfiguracaoDeLogin entende a resposta pública do servidor de login", () => {
  assert.deepEqual(lerConfiguracaoDeLogin({ disable_signup: true, mailer_autoconfirm: true }), {
    cadastroAberto: false,
    confirmacaoAutomatica: true,
  });
  assert.deepEqual(lerConfiguracaoDeLogin({ disable_signup: false, mailer_autoconfirm: false }), {
    cadastroAberto: true,
    confirmacaoAutomatica: false,
  });
  assert.deepEqual(lerConfiguracaoDeLogin({ disable_signup: false }), { cadastroAberto: true, confirmacaoAutomatica: false });
});

test("lerConfiguracaoDeLogin devolve null quando a resposta não faz sentido", () => {
  for (const ruim of [null, undefined, {}, "texto", 42, { disable_signup: "false" }, { mailer_autoconfirm: true }]) {
    assert.equal(lerConfiguracaoDeLogin(ruim), null, JSON.stringify(ruim));
  }
});
