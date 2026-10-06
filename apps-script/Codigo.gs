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
    const nome = conta.nome;
    const base = { ok: true, nome, perfil: conta.perfil, perms: conta.perms };
    const pode = p => { if (!conta.perms[p]) throw falha('Seu perfil não tem permissão para isso.'); };
    if (req.acao === 'entrar') return json(base);
    if (req.acao === 'dados') return json(Object.assign(base, { dados: dados(req.meses) }));
    if (req.acao === 'relatorio') { pode('dashboard'); return json(Object.assign(base, { relatorio: relatorio(req.de, req.ate) })); }
    if (req.acao === 'usuarios') { pode('usuarios'); return json(Object.assign(base, { equipe: equipe() })); }

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw falha('O sistema está ocupado com outro registro. Tente de novo em alguns segundos.');
    let msg, extra = {};
    try {
      switch (req.acao) {
        case 'registrar': pode('registrar_' + String((req.mov || {}).tipo)); msg = registrar(req.mov || {}, nome); break;
        case 'devolver': pode('devolver'); msg = devolver(req, nome); break;
        case 'salvarItem': pode((req.item || {}).id ? 'itens_editar' : 'itens_cadastrar'); msg = salvarItem(req, nome); break;
        case 'excluirItem': pode('itens_editar'); msg = excluirItem(req.id); break;
        case 'estornar': pode('historico_estornar'); msg = estornar(req, nome); break;
        case 'salvarUsuario': pode('usuarios'); msg = salvarUsuario(req, conta); extra.equipe = equipe(); break;
        case 'salvarPerfil': pode('usuarios'); msg = salvarPerfil(req); extra.equipe = equipe(); break;
        case 'excluirPerfil': pode('usuarios'); msg = excluirPerfil(req.nome); extra.equipe = equipe(); break;
        default: throw falha('Ação desconhecida.');
      }
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
    if (extra.equipe) return json(Object.assign(base, { msg }, extra));
    return json(Object.assign(base, { msg, dados: dados(req.meses) }));
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

function salvarItem(r, nome) {
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

// ---------- usuários, perfis e permissões ----------

const USUARIOS_CAB = ['Usuário', 'Nome', 'Senha', 'Perfil', 'Ativo'];
const PERFIL_TOTAL = 'Administração';
// [chave, título da coluna na aba Perfis, descrição, grupo]
const PERMISSOES = [
  ['painel', 'Ver painel', 'Ver o painel inicial', 'Consulta'],
  ['itens_ver', 'Ver itens', 'Ver a lista de itens e o estoque', 'Consulta'],
  ['historico_ver', 'Ver histórico', 'Ver o histórico de movimentações', 'Consulta'],
  ['dashboard', 'Ver dashboard', 'Ver o dashboard da administração', 'Consulta'],
  ['registrar_saida', 'Saída', 'Registrar saídas', 'Movimentações'],
  ['registrar_entrada', 'Entrada', 'Registrar entradas e compras', 'Movimentações'],
  ['registrar_troca', 'Troca', 'Registrar trocas de peças', 'Movimentações'],
  ['registrar_emprestimo', 'Empréstimo', 'Emprestar ferramentas', 'Movimentações'],
  ['devolver', 'Devolução', 'Registrar devoluções de empréstimos', 'Movimentações'],
  ['itens_cadastrar', 'Cadastrar itens', 'Cadastrar itens novos', 'Cadastro'],
  ['itens_editar', 'Editar itens', 'Editar, ajustar estoque e excluir itens', 'Cadastro'],
  ['historico_estornar', 'Estornar', 'Estornar lançamentos', 'Controle'],
  ['exportar', 'Exportar', 'Exportar planilhas', 'Controle'],
  ['usuarios', 'Usuários', 'Gerenciar usuários e permissões', 'Controle']
];
const PADRAO_MANUTENCAO = ['painel', 'itens_ver', 'historico_ver', 'registrar_saida', 'registrar_entrada',
  'registrar_troca', 'registrar_emprestimo', 'devolver', 'itens_cadastrar'];

function autenticar(usuario, senha) {
  const u = String(usuario || '').trim().toLowerCase();
  const s = String(senha || '').trim();
  if (!u || !s) return null;
  const us = lerUsuarios().lista.find(x => x.usuario === u);
  if (!us || !us.ativo || us.senha !== s) return null;
  const perms = lerPerfis()[us.perfil] || {};
  return { usuario: us.usuario, nome: us.nome || us.usuario, perfil: us.perfil, perms };
}

function lerUsuarios() {
  const sh = abaUsuarios();
  const vals = sh.getDataRange().getValues();
  const head = vals[0].map(h => String(h).trim());
  const c = {};
  USUARIOS_CAB.forEach(label => {
    c[label] = head.indexOf(label);
    if (c[label] < 0) throw falha('A coluna "' + label + '" não foi encontrada na aba Usuarios.');
  });
  const lista = [];
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i];
    const usuario = String(r[c['Usuário']]).trim().toLowerCase();
    if (!/^[a-z0-9._@-]{2,40}$/.test(usuario)) continue;
    lista.push({
      row: i + 1, usuario, nome: texto(r[c['Nome']], 60), senha: String(r[c['Senha']]).trim(),
      perfil: String(r[c['Perfil']]).trim(), ativo: String(r[c['Ativo']]).trim().toLowerCase().indexOf('n') !== 0
    });
  }
  return { sh, c, lista, ncol: head.length };
}

function lerPerfis() {
  const sh = abaPerfis();
  const vals = sh.getDataRange().getValues();
  const head = vals[0].map(h => String(h).trim());
  const out = {};
  for (let i = 1; i < vals.length; i++) {
    const nome = String(vals[i][0]).trim();
    if (!linhaDePerfil(vals[i], head)) continue;
    const perms = {};
    PERMISSOES.forEach(([k, label]) => {
      const j = head.indexOf(label);
      perms[k] = nome === PERFIL_TOTAL ? true : (j >= 0 && String(vals[i][j]).trim().toLowerCase().indexOf('s') === 0);
    });
    out[nome] = perms;
  }
  if (!out[PERFIL_TOTAL]) out[PERFIL_TOTAL] = PERMISSOES.reduce((m, p) => { m[p[0]] = true; return m; }, {});
  return out;
}

function equipe() {
  const perfis = lerPerfis();
  return {
    usuarios: lerUsuarios().lista.map(u => ({ usuario: u.usuario, nome: u.nome, senha: u.senha, perfil: u.perfil, ativo: u.ativo })),
    perfis: Object.keys(perfis).map(n => ({ nome: n, perms: perfis[n], fixo: n === PERFIL_TOTAL })),
    permissoes: PERMISSOES.map(([chave, coluna, descricao, grupo]) => ({ chave, descricao, grupo }))
  };
}

function salvarUsuario(r, conta) {
  const v = r.u || {};
  const original = String(r.original || '').trim().toLowerCase();
  const usuario = String(v.usuario || '').trim().toLowerCase();
  if (!/^[a-z0-9._@-]{2,40}$/.test(usuario)) throw falha('Usuário inválido: use letras minúsculas, números, ponto ou traço, sem espaços.');
  const nome = texto(v.nome, 60);
  if (!nome) throw falha('Informe o nome do colaborador.');
  const senha = String(v.senha || '').trim();
  if (senha.length < 4) throw falha('A senha precisa ter pelo menos 4 caracteres.');
  const perfis = lerPerfis();
  const perfil = String(v.perfil || '').trim();
  if (!perfis[perfil]) throw falha('Perfil não encontrado.');
  const ativo = v.ativo !== false;
  const U = lerUsuarios();
  const outro = U.lista.find(x => x.usuario === usuario && x.usuario !== original);
  if (outro) throw falha('O usuário "' + usuario + '" já existe.');
  if (original && original === conta.usuario) {
    if (!ativo) throw falha('Você não pode desativar o seu próprio login.');
    if (!perfis[perfil].usuarios) throw falha('Você não pode tirar de si mesmo o acesso a usuários e permissões.');
  }
  const linha = [];
  linha[U.c['Usuário']] = usuario; linha[U.c['Nome']] = nome; linha[U.c['Senha']] = senha;
  linha[U.c['Perfil']] = perfil; linha[U.c['Ativo']] = ativo ? 'Sim' : 'Não';
  let row;
  if (original) {
    const atual = U.lista.find(x => x.usuario === original);
    if (!atual) throw falha('Usuário não encontrado. Atualize a página.');
    row = atual.row;
  } else {
    const ultima = U.lista.length ? Math.max.apply(null, U.lista.map(x => x.row)) : 1;
    U.sh.insertRowAfter(ultima);
    row = ultima + 1;
  }
  const rng = U.sh.getRange(row, 1, 1, U.ncol);
  const vals = rng.getValues();
  linha.forEach((x, i) => { if (x !== undefined) vals[0][i] = x; });
  rng.setNumberFormat('@');
  rng.setValues(vals);
  return original ? 'Usuário atualizado: ' + nome + '.' : 'Usuário criado: ' + nome + '.';
}

function salvarPerfil(r) {
  const nome = texto(r.nome, 40);
  const original = texto(r.original, 40);
  if (!nome) throw falha('Informe o nome do perfil.');
  if (nome === PERFIL_TOTAL || original === PERFIL_TOTAL) throw falha('O perfil Administração tem acesso total e não pode ser alterado.');
  const sh = abaPerfis();
  const vals = sh.getDataRange().getValues();
  const head = vals[0].map(h => String(h).trim());
  let row = 0, ultima = 1;
  for (let i = 1; i < vals.length; i++) {
    if (!linhaDePerfil(vals[i], head)) continue;
    ultima = i + 1;
    const n = String(vals[i][0]).trim();
    if (n === nome && n !== original) throw falha('Já existe um perfil chamado "' + nome + '".');
    if (original && n === original) row = i + 1;
  }
  if (original && !row) throw falha('Perfil não encontrado. Atualize a página.');
  if (!row) { sh.insertRowAfter(ultima); row = ultima + 1; }
  const linha = head.map((h, j) => {
    if (j === 0) return nome;
    const p = PERMISSOES.find(x => x[1] === h);
    if (!p) return original ? vals[row - 1][j] : '';
    return r.perms && r.perms[p[0]] ? 'Sim' : 'Não';
  });
  const rng = sh.getRange(row, 1, 1, head.length);
  rng.setNumberFormat('@');
  rng.setValues([linha]);
  if (original && original !== nome) {
    const U = lerUsuarios();
    U.lista.filter(u => u.perfil === original).forEach(u => U.sh.getRange(u.row, U.c['Perfil'] + 1).setValue(nome));
  }
  validacaoPerfis();
  return original ? 'Perfil atualizado: ' + nome + '.' : 'Perfil criado: ' + nome + '.';
}

function excluirPerfil(nome) {
  nome = texto(nome, 40);
  if (nome === PERFIL_TOTAL) throw falha('O perfil Administração não pode ser excluído.');
  const emUso = lerUsuarios().lista.filter(u => u.perfil === nome);
  if (emUso.length) throw falha('Este perfil ainda é usado por ' + emUso.map(u => u.nome || u.usuario).join(', ') + '. Troque o perfil dessas pessoas antes.');
  const sh = abaPerfis();
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === nome) { sh.deleteRow(i + 1); validacaoPerfis(); return 'Perfil excluído.'; }
  }
  throw falha('Perfil não encontrado.');
}

// uma linha da aba Perfis só conta se tiver nome e alguma permissão marcada como Sim ou Não
function linhaDePerfil(r, head) {
  const nome = String(r[0]).trim();
  if (!nome || nome.length > 40) return false;
  return PERMISSOES.some(p => { const j = head.indexOf(p[1]); return j >= 0 && /^(sim|não|nao)$/i.test(String(r[j]).trim()); });
}

// mantém a lista de perfis da aba Usuarios igual à aba Perfis
function validacaoPerfis() {
  const U = lerUsuarios();
  const nomes = Object.keys(lerPerfis());
  U.sh.getRange(2, U.c['Perfil'] + 1, Math.max(50, U.sh.getLastRow()), 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(nomes, true).build()
  );
}

// Cria a aba "Perfis" na primeira vez: Administração (acesso total) e Manutenção.
function abaPerfis() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('Perfis');
  if (sh) return sh;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    sh = ss.getSheetByName('Perfis');
    if (sh) return sh;
    sh = ss.insertSheet('Perfis', 1);
    const head = ['Perfil'].concat(PERMISSOES.map(p => p[1]));
    const linhas = [
      head,
      [PERFIL_TOTAL].concat(PERMISSOES.map(() => 'Sim')),
      ['Manutenção'].concat(PERMISSOES.map(p => PADRAO_MANUTENCAO.indexOf(p[0]) >= 0 ? 'Sim' : 'Não'))
    ];
    const rng = sh.getRange(1, 1, linhas.length, head.length);
    rng.setNumberFormat('@');
    rng.setValues(linhas);
    sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#1F2A37').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.setFrozenColumns(1);
    sh.setColumnWidth(1, 160);
    sh.getRange(2, 2, 50, PERMISSOES.length).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['Sim', 'Não'], true).build()
    );
    sh.getRange(linhas.length + 2, 1).setValue(
      'O perfil Administração sempre tem acesso total. Os outros perfis podem ser ajustados aqui ou no site, em Usuários.'
    ).setFontStyle('italic');
    SpreadsheetApp.flush();
    return sh;
  } finally {
    lock.releaseLock();
  }
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
      ['admin', 'Administração', senhaAdmin || senhaAleatoria(), PERFIL_TOTAL, 'Sim'],
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
      'Os logins podem ser criados e editados no site, em Usuários, ou aqui mesmo. Para bloquear alguém, escreva Não em Ativo.'
    ).setFontStyle('italic');
    sh.getRange(2, 5, 50, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['Sim', 'Não'], true).build()
    );
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

// ---------- relatório para o dashboard ----------

function relatorio(de, ate) {
  const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  if (!ok(de) || !ok(ate)) throw falha('Período inválido.');
  if (de > ate) { const t = de; de = ate; ate = t; }
  const limpa = o => { const c = Object.assign({}, o); delete c._row; return c; };
  const todas = linhas(tabela('movs'));
  const ultimo = {}, preco = {};
  todas.forEach(m => {
    if (m.estornado || m.tipo === 'estorno') return;
    if (!ultimo[m.itemId] || m.data > ultimo[m.itemId]) ultimo[m.itemId] = m.data;
    if (m.tipo === 'entrada' && m.valorUnit !== '' && Number(m.valorUnit) > 0) {
      if (!preco[m.itemId] || m.data >= preco[m.itemId].data) preco[m.itemId] = { data: m.data, valor: Number(m.valorUnit) };
    }
  });
  Object.keys(preco).forEach(k => { preco[k] = preco[k].valor; });
  return {
    de, ate,
    movs: todas.filter(m => m.data >= de && m.data <= ate).map(limpa),
    itens: linhas(tabela('itens')).map(limpa),
    emprestimos: linhas(tabela('emp')).map(limpa),
    ultimo, preco
  };
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
