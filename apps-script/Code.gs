/**
 * Ponte de e-mail do Amigo Secreto (Google Apps Script).
 *
 * É a única peça que usa o seu Gmail. Ela recebe um POST (JSON) da função "sorteio" do
 * Supabase e envia o e-mail por esta conta Google. Não guarda nada e não lê a sua caixa
 * de entrada: só tem permissão para ENVIAR e-mails.
 *
 * Como colocar no ar: veja o README, passo "E-mail pelo Gmail".
 *
 * Limite do Gmail: 100 destinatários por dia em conta comum (1.500 no Google Workspace).
 * Dica: use uma conta Gmail só para o amigo secreto, assim os e-mails com os sorteados
 * não ficam na pasta "Enviados" da sua conta pessoal.
 *
 * ATENÇÃO: o SEGREDO abaixo é a senha desta ponte. Troque-o só na cópia que fica no editor do
 * Google (script.google.com). Nunca faça commit/push deste arquivo com o seu segredo dentro:
 * o repositório é público, e quem souber o endereço da ponte e o segredo consegue mandar
 * e-mails de qualquer assunto, para qualquer pessoa, pelo seu Gmail.
 */

// >>> TROQUE: invente um segredo longo (30+ caracteres, letras e números) e coloque o
// >>> MESMO valor no segredo APPS_SCRIPT_SEGREDO da função do Supabase.
const SEGREDO = 'troque-este-segredo-por-um-texto-longo-e-aleatorio';

const SEGREDO_PADRAO = 'troque-este-segredo-por-um-texto-longo-e-aleatorio';
// Segredos que aparecem em exemplos públicos: nunca valem.
const SEGREDOS_PROIBIDOS = [SEGREDO_PADRAO, 'segredo-local-de-teste-com-mais-de-vinte-caracteres'];
const NOME_PADRAO = 'Amigo Secreto';

// Tamanhos máximos (um e-mail do sorteio tem poucos KB): limita o estrago se o segredo vazar.
const MAX_ASSUNTO = 200;
const MAX_TEXTO = 10000;
const MAX_HTML = 30000;

/** Recebe o pedido da função do Supabase: mandar um e-mail, ou dizer quanto falta da cota do dia. */
function doPost(e) {
  try {
    if (SEGREDOS_PROIBIDOS.indexOf(SEGREDO) >= 0 || SEGREDO.length < 20) {
      return responder_({ ok: false, erro: 'Troque o SEGREDO no Code.gs da ponte (mínimo 20 caracteres, e não use o de exemplo) e implante de novo.' });
    }

    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (typeof d.segredo !== 'string' || d.segredo !== SEGREDO) {
      return responder_({ ok: false, erro: 'Segredo incorreto: confira APPS_SCRIPT_SEGREDO no Supabase.' });
    }

    // Quantos e-mails o Gmail ainda deixa mandar hoje (a função consulta antes de sortear).
    if (d.acao === 'cota') {
      return responder_({ ok: true, cota_restante: MailApp.getRemainingDailyQuota() });
    }

    if (typeof d.para !== 'string' || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(d.para)) {
      return responder_({ ok: false, erro: 'Endereço de e-mail inválido.' });
    }
    if (typeof d.assunto !== 'string' || d.assunto === '' || typeof d.texto !== 'string') {
      return responder_({ ok: false, erro: 'Faltou o assunto ou o texto do e-mail.' });
    }
    if (d.assunto.length > MAX_ASSUNTO || d.texto.length > MAX_TEXTO ||
        (typeof d.html === 'string' && d.html.length > MAX_HTML)) {
      return responder_({ ok: false, erro: 'E-mail grande demais para esta ponte.' });
    }

    const opcoes = {
      to: d.para,
      subject: d.assunto,
      body: d.texto,
      name: typeof d.nome === 'string' && d.nome !== '' ? d.nome.slice(0, 80) : NOME_PADRAO,
    };
    if (typeof d.html === 'string' && d.html !== '') opcoes.htmlBody = d.html;

    MailApp.sendEmail(opcoes);
    return responder_({ ok: true, cota_restante: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return responder_({ ok: false, erro: String((err && err.message) || err) });
  }
}

/** Abrir o endereço do app da Web no navegador mostra esta frase: serve para conferir a implantação. */
function doGet() {
  return ContentService.createTextOutput('Ponte de e-mail do Amigo Secreto: no ar.');
}

/**
 * Rode esta função UMA vez no editor (menu "Executar") para autorizar o envio de e-mails
 * e conferir que funciona: ela manda um e-mail de teste para a própria conta.
 */
function testar() {
  const eu = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail(eu, 'Teste da ponte do Amigo Secreto', 'Funcionou! A ponte já pode enviar e-mails.');
  console.log('E-mail de teste enviado para ' + eu + '. Cota restante hoje: ' + MailApp.getRemainingDailyQuota());
}

function responder_(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}
