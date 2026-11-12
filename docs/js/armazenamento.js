// localStorage / sessionStorage que nunca quebram a tela: em aba anônima ou com o
// armazenamento bloqueado, o site só deixa de "lembrar" as coisas.

function criar(obterArmazem) {
  return {
    ler(chave) {
      try {
        return obterArmazem().getItem(chave);
      } catch {
        return null;
      }
    },
    gravar(chave, valor) {
      try {
        obterArmazem().setItem(chave, valor);
      } catch {
        // sem armazenamento: tudo bem
      }
    },
    apagar(chave) {
      try {
        obterArmazem().removeItem(chave);
      } catch {
        // idem
      }
    },
  };
}

/** Dura enquanto a aba estiver aberta (ex.: para onde voltar depois do login). */
export const temporario = criar(() => sessionStorage);
/** Fica no aparelho (ex.: "já confirmei meu e-mail neste evento"). */
export const permanente = criar(() => localStorage);
