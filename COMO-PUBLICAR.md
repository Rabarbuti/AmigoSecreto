# Amigo Secreto da Família — como colocar no ar

O site roda de graça no Google Apps Script e manda os e-mails pelo seu Gmail.
Leva uns 5 minutos.

## 1. Criar o projeto

1. Abra <https://script.google.com> com a sua conta Google e clique em **Novo projeto**.
2. Dê um nome ao projeto (no alto, "Projeto sem título") — por exemplo *Amigo Secreto*.
3. Apague o que estiver em `Código.gs` e cole todo o conteúdo de **Code.gs**.
4. **Troque a senha** na linha `const SENHA_ORGANIZADOR = 'troque-esta-senha';`.
5. Clique no **+** ao lado de "Arquivos" → **HTML**, chame de `Index` (sem `.html`)
   e cole todo o conteúdo de **Index.html** no lugar do que vier.
6. Salve (Ctrl+S).

## 2. Publicar

1. **Implantar** → **Nova implantação** → engrenagem → **App da Web**.
2. Preencha:
   - **Executar como:** Eu
   - **Quem pode acessar:** Qualquer pessoa
3. **Implantar** e autorize o acesso ao Gmail quando o Google pedir
   (aparece "O Google não verificou este app": clique em **Avançado** →
   **Acessar Amigo Secreto (não seguro)** — é o seu próprio script).
4. Copie o **URL do app da Web**. Esse é o link da família.

## 3. Usar

- **Você (organizador):** abra o link com `?admin=1` no final
  (`https://script.google.com/macros/s/.../exec?admin=1`), digite a senha, escreva os
  nomes (um por linha), um recado opcional (valor, data da troca) e **Salvar lista**.
- **A família:** manda o link normal no grupo. Cada um clica no próprio nome e digita
  o e-mail duas vezes. Quem já se cadastrou aparece com ✓ e não pode ser clicado de novo.
- **O sorteio sai sozinho** quando o último se cadastrar, e cada um recebe só o nome
  de quem tirou. Você também pode apertar **Sortear e enviar agora** na área do
  organizador depois que todos tiverem e-mail.
- Se alguém clicar no nome errado ou digitar o e-mail errado, use **Apagar e-mail**
  na área do organizador e peça para a pessoa se cadastrar de novo.

## Sobre o sigilo

- Os pares **não ficam guardados** em lugar nenhum; nem a página do organizador mostra.
- Os e-mails saem do seu Gmail. Logo depois do envio o script move esses e-mails para a
  **Lixeira** do Gmail, para não aparecerem nos seus Enviados. Durante 30 dias eles ainda
  estão na Lixeira — é só não abrir (ou esvaziar a Lixeira).
- Ninguém tira a si mesmo, e o sorteio forma uma roda só: todo mundo dá e recebe um presente.

## Se mudar o código depois

Implantar → **Gerenciar implantações** → lápis → Versão: **Nova versão** → Implantar.
Assim o link continua o mesmo.
