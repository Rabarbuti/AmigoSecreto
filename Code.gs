/**
 * Amigo Secreto da Família — servidor (Google Apps Script).
 *
 * Como funciona:
 *  - O organizador abre o site com ?admin=1, digita a senha abaixo e cadastra os nomes.
 *  - Cada pessoa abre o site, clica no próprio nome e informa o e-mail.
 *  - Quando todos tiverem e-mail, o sorteio acontece sozinho e cada um recebe
 *    por e-mail o nome de quem tirou. O organizador também pode mandar sortear.
 *  - Os pares NÃO ficam guardados em lugar nenhum, e os e-mails enviados vão
 *    para a lixeira do Gmail logo depois do envio (para o organizador não ver
 *    sem querer na pasta Enviados).
 */

// >>> TROQUE ESTA SENHA antes de publicar. É ela que abre a página do organizador.
const SENHA_ORGANIZADOR = 'troque-esta-senha';

const TITULO = 'Amigo Secreto da Família';
const ASSUNTO_EMAIL = 'Amigo Secreto da Família — seu sorteado';
const MINIMO_PARTICIPANTES = 3;

// ---------------------------------------------------------------- página

function doGet(e) {
  const t = HtmlService.createTemplateFromFile('Index');
  t.modoAdmin = !!(e && e.parameter && e.parameter.admin);
  t.urlPublico = ScriptApp.getService().getUrl(); // link para a família, sem ?admin=1
  return t.evaluate()
    .setTitle(TITULO)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---------------------------------------------------------------- estado

// Estado guardado nas propriedades do script:
// { pessoas: [{nome, email}], recado: '', sorteadoEm: null | ISO }
function lerEstado_() {
  const bruto = PropertiesService.getScriptProperties().getProperty('estado');
  if (!bruto) return { pessoas: [], recado: '', sorteadoEm: null };
  return JSON.parse(bruto);
}

function gravarEstado_(estado) {
  PropertiesService.getScriptProperties().setProperty('estado', JSON.stringify(estado));
}

function comTrava_(fn) {
  const trava = LockService.getScriptLock();
  trava.waitLock(20000);
  try {
    return fn();
  } finally {
    trava.releaseLock();
  }
}

function conferirSenha_(senha) {
  if (senha !== SENHA_ORGANIZADOR) throw new Error('Senha incorreta.');
}

function normalizar_(texto) {
  return String(texto || '').trim().replace(/\s+/g, ' ');
}

function emailValido_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------------------------------------------------------------- participantes

/** O que qualquer visitante vê: nomes e se já cadastraram e-mail. Nunca os e-mails. */
function estadoPublico() {
  const estado = lerEstado_();
  return {
    titulo: TITULO,
    sorteado: !!estado.sorteadoEm,
    recado: estado.recado || '',
    pessoas: estado.pessoas.map(p => ({ nome: p.nome, pronto: !!p.email })),
  };
}

/** Um participante liga o próprio nome a um e-mail. */
function cadastrarEmail(nome, email) {
  return comTrava_(() => {
    const estado = lerEstado_();
    if (estado.sorteadoEm) throw new Error('O sorteio já foi feito.');
    nome = normalizar_(nome);
    email = normalizar_(email).toLowerCase();
    if (!emailValido_(email)) throw new Error('Esse e-mail não parece válido.');

    const pessoa = estado.pessoas.find(p => p.nome === nome);
    if (!pessoa) throw new Error('Nome não encontrado na lista.');
    if (pessoa.email) {
      throw new Error('Esse nome já tem e-mail cadastrado. Se foi engano, fale com o organizador.');
    }
    pessoa.email = email;
    gravarEstado_(estado);

    let sorteioFeito = false;
    const todosProntos = estado.pessoas.length >= MINIMO_PARTICIPANTES &&
      estado.pessoas.every(p => p.email);
    if (todosProntos) {
      sortearEEnviar_(estado);
      sorteioFeito = true;
    }
    return { ok: true, sorteioFeito: sorteioFeito, publico: estadoPublico() };
  });
}

// ---------------------------------------------------------------- organizador

/** Tudo o que o organizador vê (inclui e-mails, para conferir digitação). */
function adminEstado(senha) {
  conferirSenha_(senha);
  const estado = lerEstado_();
  return {
    sorteadoEm: estado.sorteadoEm,
    recado: estado.recado || '',
    pessoas: estado.pessoas.map(p => ({ nome: p.nome, email: p.email || '' })),
  };
}

/** Grava a lista de nomes (um por linha). Quem já tinha e-mail continua com ele. */
function adminSalvarNomes(senha, textoNomes, recado) {
  conferirSenha_(senha);
  return comTrava_(() => {
    const estado = lerEstado_();
    if (estado.sorteadoEm) throw new Error('O sorteio já foi feito. Use "Recomeçar" para um novo.');

    const nomes = [];
    String(textoNomes || '').split(/\r?\n/).map(normalizar_).forEach(n => {
      if (n && nomes.indexOf(n) < 0) nomes.push(n);
    });
    const antigos = {};
    estado.pessoas.forEach(p => { antigos[p.nome] = p.email; });

    estado.pessoas = nomes.map(n => ({ nome: n, email: antigos[n] || '' }));
    estado.recado = normalizar_(recado);
    gravarEstado_(estado);
    return adminEstado(senha);
  });
}

/** Apaga o e-mail de uma pessoa (ela cadastrou errado ou alguém clicou no nome errado). */
function adminLimparEmail(senha, nome) {
  conferirSenha_(senha);
  return comTrava_(() => {
    const estado = lerEstado_();
    if (estado.sorteadoEm) throw new Error('O sorteio já foi feito.');
    const pessoa = estado.pessoas.find(p => p.nome === nome);
    if (pessoa) pessoa.email = '';
    gravarEstado_(estado);
    return adminEstado(senha);
  });
}

/** Sorteia e envia agora (exige todos com e-mail). */
function adminSortear(senha) {
  conferirSenha_(senha);
  return comTrava_(() => {
    const estado = lerEstado_();
    if (estado.sorteadoEm) throw new Error('O sorteio já foi feito.');
    if (estado.pessoas.length < MINIMO_PARTICIPANTES) {
      throw new Error('São precisos pelo menos ' + MINIMO_PARTICIPANTES + ' participantes.');
    }
    const faltando = estado.pessoas.filter(p => !p.email).map(p => p.nome);
    if (faltando.length) throw new Error('Ainda sem e-mail: ' + faltando.join(', '));
    sortearEEnviar_(estado);
    return adminEstado(senha);
  });
}

/** Apaga tudo para começar um novo amigo secreto. */
function adminRecomecar(senha) {
  conferirSenha_(senha);
  return comTrava_(() => {
    gravarEstado_({ pessoas: [], recado: '', sorteadoEm: null });
    return adminEstado(senha);
  });
}

// ---------------------------------------------------------------- sorteio

/**
 * Embaralha todo mundo numa roda e cada pessoa tira a seguinte da roda:
 * ninguém tira a si mesmo, todos são tirados e não há "panelinhas".
 * Retorna um vetor em que destino[i] é o índice de quem a pessoa i tirou.
 */
function sortearCiclo_(n) {
  const ordem = [];
  for (let i = 0; i < n; i++) ordem.push(i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = ordem[i]; ordem[i] = ordem[j]; ordem[j] = tmp;
  }
  const destino = new Array(n);
  for (let k = 0; k < n; k++) destino[ordem[k]] = ordem[(k + 1) % n];
  return destino;
}

function sortearEEnviar_(estado) {
  const pessoas = estado.pessoas;
  const destino = sortearCiclo_(pessoas.length);

  pessoas.forEach((p, i) => {
    const tirado = pessoas[destino[i]].nome;
    GmailApp.sendEmail(p.email, ASSUNTO_EMAIL, textoEmail_(p.nome, tirado, estado.recado), {
      name: TITULO,
      htmlBody: htmlEmail_(p.nome, tirado, estado.recado),
    });
  });

  // Os pares não são gravados. Marca só que o sorteio aconteceu.
  estado.sorteadoEm = new Date().toISOString();
  gravarEstado_(estado);

  // Tira os e-mails da pasta Enviados para o organizador não ver sem querer.
  // "-to:me" poupa o e-mail do próprio organizador, se ele participa com este Gmail.
  Utilities.sleep(3000);
  try {
    GmailApp.search('in:sent subject:"' + ASSUNTO_EMAIL + '" newer_than:1d -to:me')
      .forEach(t => t.moveToTrash());
  } catch (err) {
    console.warn('Não consegui mover os enviados para a lixeira: ' + err);
  }
}

function escaparHtml_(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function textoEmail_(nome, tirado, recado) {
  return 'Olá, ' + nome + '!\n\n' +
    'No amigo secreto da família você tirou:\n\n    ' + tirado + '\n\n' +
    (recado ? recado + '\n\n' : '') +
    'Shhh... não conte para ninguém!';
}

function htmlEmail_(nome, tirado, recado) {
  return '' +
    '<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:28px;' +
    'background:#fbf6ee;border:1px solid #e6d9c3;border-radius:14px;color:#3b2a1a">' +
    '<p style="font-size:15px;margin:0 0 6px">Olá, ' + escaparHtml_(nome) + '!</p>' +
    '<p style="font-size:15px;margin:0 0 22px">No amigo secreto da família você tirou:</p>' +
    '<p style="font-size:30px;font-weight:bold;text-align:center;margin:0 0 22px;color:#a3322a">' +
    escaparHtml_(tirado) + '</p>' +
    (recado ? '<p style="font-size:14px;margin:0 0 18px;padding:12px;background:#fff;' +
      'border-radius:8px">' + escaparHtml_(recado) + '</p>' : '') +
    '<p style="font-size:13px;margin:0;color:#8a7558">Shhh... não conte para ninguém! 🎁</p>' +
    '</div>';
}
