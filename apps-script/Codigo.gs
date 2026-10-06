/**
 * Estoque da Manutenção — banco de dados na planilha do Google.
 *
 * Como instalar (uma vez só):
 *  1. Abra a planilha "Estoque da Manutenção" no Google Drive.
 *  2. Menu Extensões → Apps Script. Apague o que estiver lá e cole este arquivo inteiro.
 *  3. Clique em Implantar → Nova implantação → tipo "App da Web".
 *       Executar como: Eu   |   Quem pode acessar: Qualquer pessoa
 *  4. Autorize o acesso quando o Google pedir e copie o link do "App da Web".
 *
 * Para atualizar o código depois: cole a versão nova, salve e use
 *   Implantar → Gerenciar implantações → lápis → Versão: Nova versão → Implantar.
 *   Assim o link do App da Web continua o mesmo.
 *
 * Logins: cada pessoa tem uma linha na aba "Usuarios" (usuário, nome, senha, perfil, ativo).
 * Na primeira vez que o sistema roda, a aba é criada sozinha com a administração e 3 funcionários.
 */

const ABAS = {
  itens: {
    nome: 'Itens',
    cols: [
      ['id', 'ID'], ['codigo', 'Código'], ['nome', 'Item'], ['categoria', 'Categoria'],
      ['tipoItem', 'Tipo'], ['unidade', 'Unidade'], ['local', 'Local'], ['qtd', 'Estoque'],
      ['minimo', 'Mínimo'], ['obs', 'Observação'], ['criadoEm', 'Criado em'], ['atualizadoEm', 'Atualizado em']
    ],
    num: ['qtd', 'minimo']
  },
  movs: {
    nome: 'Movimentacoes',
    cols: [
      ['id', 'ID'], ['data', 'Data'], ['tipo', 'Tipo'], ['itemId', 'ID do item'], ['itemCodigo', 'Código'],
      ['itemNome', 'Item'], ['qtd', 'Quantidade'], ['unidade', 'Unidade'], ['delta', 'Efeito no estoque'],
      ['responsavel', 'Responsável'], ['destino', 'Destino'], ['motivo', 'OS / motivo'],
      ['velhoDestino', 'Peça retirada'], ['fornecedor', 'Fornecedor'], ['nf', 'NF'],
      ['valorUnit', 'Valor unitário'], ['previsao', 'Devolver até'], ['estadoDevolucao', 'Estado na devolução'],
      ['obs', 'Observação'], ['registradoPor', 'Registrado por'], ['criadoEm', 'Criado em'],
      ['estornado', 'Estornado'], ['estornoDe', 'Estorno de'], ['emprestimoId', 'ID do empréstimo']
    ],
    num: ['qtd', 'delta', 'valorUnit']
  },
  emp: {
    nome: 'Emprestimos',
    cols: [
      ['id', 'ID'], ['itemId', 'ID do item'], ['itemCodigo', 'Código'], ['itemNome', 'Item'],
      ['qtd', 'Quantidade'], ['unidade', 'Unidade'], ['responsavel', 'Com quem'], ['destino', 'Onde'],
      ['data', 'Saiu em'], ['previsao', 'Devolver até'], ['registradoPor', 'Registrado por'],
      ['criadoEm', 'Criado em'], ['movId', 'ID da movimentação']
    ],
    num: ['qtd']
  }
};

const TIPOS = {
  entrada: 'Entrada', saida: 'Saída', troca: 'Troca', emprestimo: 'Empréstimo',
  devolucao: 'Devolução', ajuste: 'Ajuste', estorno: 'Estorno'
};
const TIPO_POR_NOME = Object.keys(TIPOS).reduce((m, k) => { m[TIPOS[k]] = k; return m; }, {});

// ---------- entrada da web ----------

function doGet() {
  return json({ ok: true, app: 'Estoque da Manutenção' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return json({ ok: false, erro: 'Pedido inválido.' }); }
  try {
    const conta = autenticar(req.usuario, req.senha);
    if (!conta) return json({ ok: false, codigo: 'senha', erro: 'Usuário ou senha incorretos.' });
    const papel = conta.papel, nome = conta.nome;
    if (req.acao === 'entrar') return json({ ok: true, papel, nome });
    if (req.acao === 'dados') return json({ ok: true, papel, nome, dados: dados(req.meses) });

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw falha('O sistema está ocupado com outro registro. Tente de novo em alguns segundos.');
    let msg;
    try {
      switch (req.acao) {
        case 'registrar': msg = registrar(req.mov || {}, nome); break;
        case 'devolver': msg = devolver(req, nome); break;
        case 'salvarItem': msg = salvarItem(req, nome, papel); break;
        case 'excluirItem': soAdmin(papel); msg = excluirItem(req.id); break;
        case 'estornar': soAdmin(papel); msg = estornar(req, nome); break;
        default: throw falha('Ação desconhecida.');
      }
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
    return json({ ok: true, papel, nome, msg, dados: dados(req.meses) });
  } catch (err) {
    return json({ ok: false, erro: err.paraUsuario ? err.message : 'Erro no servidor: ' + err.message });
  }
}

// ---------- ações ----------

function registrar(m, nome) {
  const tipo = m.tipo;
  if (['entrada', 'saida', 'troca', 'emprestimo'].indexOf(tipo) < 0) throw falha('Tipo de movimentação inválido.');
  const qtd = numero(m.qtd);
  if (!(qtd > 0)) throw falha('Informe uma quantidade maior que zero.');
  if (tipo !== 'entrada') {
    if (!texto(m.responsavel)) throw falha('Informe quem retirou.');
    if (!texto(m.destino)) throw falha('Informe o destino.');
  }
  if (tipo === 'troca' && !texto(m.velhoDestino)) throw falha('Informe o que foi feito com a peça retirada.');

  const ti = tabela('itens');
  const it = linhas(ti).find(x => x.id === m.itemId);
  if (!it) throw falha('Item não encontrado. Atualize a página.');
  const atual = Number(it.qtd) || 0;
  const delta = tipo === 'entrada' ? qtd : -qtd;
  if (atual + delta < 0) throw falha('Estoque insuficiente: há ' + fmt(atual) + ' ' + it.unidade + ' de ' + it.nome + '.');

  gravar(ti, { qtd: arred(atual + delta), atualizadoEm: agora() }, it._row);
  const id = novoId('M');
  const data = dataValida(m.data);
  const mov = {
    id, data, tipo: TIPOS[tipo], itemId: it.id, itemCodigo: it.codigo, itemNome: it.nome, qtd, unidade: it.unidade, delta,
    responsavel: texto(m.responsavel, 80), destino: texto(m.destino, 120), motivo: texto(m.motivo, 160),
    velhoDestino: texto(m.velhoDestino, 80), fornecedor: texto(m.fornecedor, 120), nf: texto(m.nf, 40),
    valorUnit: m.valorUnit === '' || m.valorUnit == null ? '' : numero(m.valorUnit),
    previsao: m.previsao ? dataValida(m.previsao) : '', obs: texto(m.obs, 300), registradoPor: nome, criadoEm: agora()
  };
  if (tipo === 'emprestimo') {
    const eid = novoId('E');
    mov.emprestimoId = eid;
    gravar(tabela('emp'), {
      id: eid, itemId: it.id, itemCodigo: it.codigo, itemNome: it.nome, qtd, unidade: it.unidade,
      responsavel: mov.responsavel, destino: mov.destino, data, previsao: mov.previsao,
      registradoPor: nome, criadoEm: agora(), movId: id
    });
  }
  gravar(tabela('movs'), mov);
  return TIPOS[tipo] + (tipo === 'emprestimo' ? ' registrado: ' : ' registrada: ') + fmt(qtd) + ' ' + it.unidade + ' de ' + it.nome + '.';
}

function devolver(r, nome) {
  const te = tabela('emp');
  const e = linhas(te).find(x => x.id === r.emprestimoId);
  if (!e) throw falha('Este empréstimo já foi encerrado. Atualize a página.');
  const estado = texto(r.estado, 40) || 'Em bom estado';
  const perdida = estado.indexOf('Não voltou') === 0;
  const qtd = Number(e.qtd) || 0;
  const ti = tabela('itens');
  const it = linhas(ti).find(x => x.id === e.itemId);
  if (!perdida && it) gravar(ti, { qtd: arred((Number(it.qtd) || 0) + qtd), atualizadoEm: agora() }, it._row);
  gravar(tabela('movs'), {
    id: novoId('M'), data: dataValida(r.data), tipo: TIPOS.devolucao, itemId: e.itemId, itemCodigo: e.itemCodigo,
    itemNome: e.itemNome, qtd, unidade: e.unidade, delta: perdida ? 0 : qtd, responsavel: e.responsavel,
    destino: e.destino, estadoDevolucao: estado, obs: texto(r.obs, 300), registradoPor: nome, criadoEm: agora(),
    emprestimoId: e.id
  });
  te.sh.deleteRow(e._row);
  return perdida ? 'Perda registrada.' : 'Devolução registrada.';
}

function salvarItem(r, nome, papel) {
  const v = r.item || {};
  const ti = tabela('itens');
  const todos = linhas(ti);
  const nomeItem = texto(v.nome, 120);
  if (!nomeItem) throw falha('Informe o nome do item.');
  let codigo = texto(v.codigo, 30);
  if (!codigo) codigo = proxCodigo(todos);
  const dup = todos.find(x => x.codigo === codigo && x.id !== v.id);
  if (dup) throw falha('O código ' + codigo + ' já é usado por "' + dup.nome + '".');
  const qtd = numero(v.qtd || 0), minimo = numero(v.minimo || 0);
  if (!(qtd >= 0)) throw falha('Quantidade inválida.');
  if (!(minimo >= 0)) throw falha('Estoque mínimo inválido.');
  const base = {
    codigo, nome: nomeItem, categoria: texto(v.categoria, 60), tipoItem: texto(v.tipoItem, 40),
    unidade: texto(v.unidade, 15) || 'un', local: texto(v.local, 60), minimo, obs: texto(v.obs, 300), atualizadoEm: agora()
  };

  if (!v.id) {
    const id = novoId('I');
    gravar(ti, Object.assign({ id, qtd, criadoEm: agora() }, base));
    if (qtd > 0) {
      gravar(tabela('movs'), {
        id: novoId('M'), data: hoje(), tipo: TIPOS.ajuste, itemId: id, itemCodigo: codigo, itemNome: nomeItem,
        qtd, unidade: base.unidade, delta: qtd, motivo: 'Cadastro com estoque inicial', registradoPor: nome, criadoEm: agora()
      });
    }
    return 'Item cadastrado: ' + nomeItem + '.';
  }

  soAdmin(papel);
  const it = todos.find(x => x.id === v.id);
  if (!it) throw falha('Item não encontrado. Atualize a página.');
  const atual = Number(it.qtd) || 0;
  if (qtd !== atual) {
    const motivo = texto(r.motivo, 160);
    if (!motivo) throw falha('Explique o motivo da mudança no estoque.');
    base.qtd = qtd;
    gravar(tabela('movs'), {
      id: novoId('M'), data: hoje(), tipo: TIPOS.ajuste, itemId: it.id, itemCodigo: codigo, itemNome: nomeItem,
      qtd: Math.abs(arred(qtd - atual)), unidade: base.unidade, delta: arred(qtd - atual),
      motivo: motivo + ' (de ' + fmt(atual) + ' para ' + fmt(qtd) + ')', registradoPor: nome, criadoEm: agora()
    });
  }
  gravar(ti, base, it._row);
  return 'Alterações salvas.';
}

function excluirItem(id) {
  const ti = tabela('itens');
  const it = linhas(ti).find(x => x.id === id);
  if (!it) throw falha('Item não encontrado.');
  ti.sh.deleteRow(it._row);
  return 'Item excluído. O histórico continua guardado.';
}

function estornar(r, nome) {
  const motivo = texto(r.motivo, 160);
  if (!motivo) throw falha('Informe o motivo do estorno.');
  const tm = tabela('movs');
  const m = linhas(tm).find(x => x.id === r.movId);
  if (!m) throw falha('Lançamento não encontrado.');
  if (m.estornado) throw falha('Este lançamento já foi estornado.');
  if (m.tipo === 'estorno') throw falha('Um estorno não pode ser estornado.');
  const inv = -(Number(m.delta) || 0);
  const ti = tabela('itens');
  const it = linhas(ti).find(x => x.id === m.itemId);
  if (inv !== 0 && it) {
    const novo = arred((Number(it.qtd) || 0) + inv);
    if (novo < 0) throw falha('Não dá para estornar: o estoque ficaria negativo (' + fmt(novo) + ').');
    gravar(ti, { qtd: novo, atualizadoEm: agora() }, it._row);
  }
  const eid = novoId('M');
  gravar(tm, { estornado: 'sim' }, m._row);
  gravar(tm, {
    id: eid, data: hoje(), tipo: TIPOS.estorno, itemId: m.itemId, itemCodigo: m.itemCodigo, itemNome: m.itemNome,
    qtd: Math.abs(inv), unidade: m.unidade, delta: inv, motivo, estornoDe: m.id, registradoPor: nome, criadoEm: agora()
  });
  if (m.tipo === 'emprestimo' && m.emprestimoId) {
    const te = tabela('emp');
    const e = linhas(te).find(x => x.id === m.emprestimoId);
    if (e) te.sh.deleteRow(e._row);
  }
  return 'Lançamento estornado.';
}

// ---------- leitura ----------

function dados(meses) {
  const ms = (Array.isArray(meses) ? meses : []).filter(x => /^\d{4}-\d{2}$/.test(String(x)));
  const limpa = o => { const c = Object.assign({}, o); delete c._row; return c; };
  return {
    itens: linhas(tabela('itens')).map(limpa),
    emprestimos: linhas(tabela('emp')).map(limpa),
    movs: linhas(tabela('movs')).filter(m => ms.indexOf(String(m.data).slice(0, 7)) >= 0).map(limpa)
  };
}

function tabela(chave) {
  const def = ABAS[chave];
  const sh = SpreadsheetApp.getActive().getSheetByName(def.nome);
  if (!sh) throw falha('A aba "' + def.nome + '" não foi encontrada na planilha.');
  const ncol = sh.getLastColumn();
  const head = sh.getRange(1, 1, 1, ncol).getValues()[0].map(h => String(h).trim());
  const idx = {};
  def.cols.forEach(([k, label]) => {
    const i = head.indexOf(label);
    if (i < 0) throw falha('A coluna "' + label + '" não foi encontrada na aba ' + def.nome + '.');
    idx[k] = i;
  });
  return { sh, def, idx, ncol };
}

function linhas(t) {
  const n = t.sh.getLastRow() - 1;
  if (n < 1) return [];
  const vals = t.sh.getRange(2, 1, n, t.ncol).getValues();
  const out = [];
  vals.forEach((r, i) => {
    const o = { _row: i + 2 };
    t.def.cols.forEach(([k]) => { o[k] = celula(r[t.idx[k]], t.def.num.indexOf(k) >= 0); });
    if (!o.id) return;
    if (t.def === ABAS.movs) o.tipo = TIPO_POR_NOME[o.tipo] || String(o.tipo).toLowerCase();
    out.push(o);
  });
  return out;
}

function gravar(t, obj, row) {
  const novo = !row;
  if (novo) row = t.sh.getLastRow() + 1;
  const rng = t.sh.getRange(row, 1, 1, t.ncol);
  const vals = novo ? [new Array(t.ncol).fill('')] : rng.getValues();
  const fmts = rng.getNumberFormats();
  t.def.cols.forEach(([k]) => {
    if (!(k in obj)) return;
    const i = t.idx[k];
    const isNum = t.def.num.indexOf(k) >= 0;
    let v = obj[k];
    if (v === undefined || v === null) v = '';
    if (isNum) {
      vals[0][i] = v === '' ? '' : Number(v);
      fmts[0][i] = k === 'valorUnit' ? '"R$" #,##0.00' : 'General';
    } else {
      vals[0][i] = String(v);
      fmts[0][i] = '@';
    }
  });
  rng.setNumberFormats(fmts);
  rng.setValues(vals);
}

// ---------- utilidades ----------

const USUARIOS_CAB = ['Usuário', 'Nome', 'Senha', 'Perfil', 'Ativo'];

function autenticar(usuario, senha) {
  const u = String(usuario || '').trim().toLowerCase();
  const s = String(senha || '').trim();
  if (!u || !s) return null;
  const sh = abaUsuarios();
  const vals = sh.getDataRange().getValues();
  const head = vals[0].map(h => String(h).trim());
  const c = {};
  USUARIOS_CAB.forEach(label => {
    c[label] = head.indexOf(label);
    if (c[label] < 0) throw falha('A coluna "' + label + '" não foi encontrada na aba Usuarios.');
  });
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i];
    if (String(r[c['Usuário']]).trim().toLowerCase() !== u) continue;
    if (String(r[c['Ativo']]).trim().toLowerCase().indexOf('n') === 0) return null;
    if (String(r[c['Senha']]).trim() !== s) return null;
    const perfil = String(r[c['Perfil']]).trim().toLowerCase();
    return {
      papel: perfil.indexOf('admin') === 0 ? 'admin' : 'equipe',
      nome: texto(r[c['Nome']], 60) || String(r[c['Usuário']]).trim()
    };
  }
  return null;
}

// Cria a aba "Usuarios" na primeira vez, com a administração e 3 funcionários.
function abaUsuarios() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('Usuarios');
  if (sh) return sh;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    sh = ss.getSheetByName('Usuarios');
    if (sh) return sh;
    // aproveita a senha de administração que já existia na aba Config
    let senhaAdmin = '';
    const cfg = ss.getSheetByName('Config');
    if (cfg) {
      cfg.getDataRange().getValues().forEach(r => {
        const k = String(r[0]).trim().toLowerCase();
        if (k === 'senha da administração' || k === 'senha da administracao') senhaAdmin = String(r[1]).trim();
      });
    }
    sh = ss.insertSheet('Usuarios', 0);
    const linhas = [
      USUARIOS_CAB,
      ['admin', 'Administração', senhaAdmin || senhaAleatoria(), 'Administração', 'Sim'],
      ['funcionario1', 'Funcionário 1', senhaAleatoria(), 'Manutenção', 'Sim'],
      ['funcionario2', 'Funcionário 2', senhaAleatoria(), 'Manutenção', 'Sim'],
      ['funcionario3', 'Funcionário 3', senhaAleatoria(), 'Manutenção', 'Sim']
    ];
    const rng = sh.getRange(1, 1, linhas.length, USUARIOS_CAB.length);
    rng.setNumberFormat('@');
    rng.setValues(linhas);
    sh.getRange(1, 1, 1, USUARIOS_CAB.length).setFontWeight('bold').setBackground('#1F2A37').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.setColumnWidths(1, 5, 150);
    sh.getRange(linhas.length + 2, 1).setValue(
      'Para criar um login, preencha uma linha nova. Perfil: Manutenção ou Administração. Para bloquear alguém, escreva Não em Ativo.'
    ).setFontStyle('italic');
    sh.getRange(2, 4, 50, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['Manutenção', 'Administração'], true).build()
    );
    sh.getRange(2, 5, 50, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['Sim', 'Não'], true).build()
    );
    // a senha compartilhada da equipe deixa de valer
    if (cfg) {
      const v = cfg.getDataRange().getValues();
      for (let i = 0; i < v.length; i++) {
        const k = String(v[i][0]).trim().toLowerCase();
        if (k.indexOf('senha da') === 0) {
          cfg.getRange(i + 1, 2).setValue('');
          cfg.getRange(i + 1, 3).setValue('Não é mais usada. Os logins agora ficam na aba Usuarios.');
        }
      }
    }
    SpreadsheetApp.flush();
    return sh;
  } finally {
    lock.releaseLock();
  }
}

function senhaAleatoria() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function soAdmin(papel) {
  if (papel !== 'admin') throw falha('Só a administração pode fazer isso.');
}

function celula(v, isNum) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (isNum) { if (v === '' || v === null) return ''; const n = Number(v); return isNaN(n) ? '' : n; }
  return v === null || v === undefined ? '' : String(v);
}

function texto(v, max) {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return max ? s.slice(0, max) : s;
}

function numero(v) {
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  return Number(s.indexOf(',') >= 0 ? s.replace(/\./g, '').replace(',', '.') : s);
}

function arred(n) { return Math.round(n * 1000) / 1000; }
function fmt(n) { return String(arred(n)).replace('.', ','); }
function hoje() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function agora() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'); }
function dataValida(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : hoje(); }
function novoId(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function proxCodigo(todos) {
  let max = 0;
  todos.forEach(it => { const m = /(\d+)\s*$/.exec(it.codigo || ''); if (m) max = Math.max(max, Number(m[1])); });
  return 'MAN-' + ('000' + (max + 1)).slice(-4);
}

function falha(msg) { const e = new Error(msg); e.paraUsuario = true; return e; }

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
