(() => {
"use strict";
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const hoje = () => { const d = new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
const mesDe = iso => (iso||hoje()).slice(0,7);
const fData = iso => { if(!iso) return "—"; const p = String(iso).slice(0,10).split("-"); return p.length===3 ? p[2]+"/"+p[1]+"/"+p[0] : String(iso); };
const fNum = n => (Number(n)||0).toLocaleString("pt-BR",{maximumFractionDigits:3});
const fBRL = n => (Number(n)||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const pQtd = s => { const t = String(s??"").trim(); if(!t) return NaN; return t.includes(",") ? Number(t.replace(/\./g,"").replace(",",".")) : Number(t); };
const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const nomeMes = ym => { const [y,m] = ym.split("-"); return MESES[+m-1]+" de "+y; };
const TIPOS = {
  entrada:{nome:"Entrada", verbo:"Registrar entrada"},
  saida:{nome:"Saída", verbo:"Registrar saída"},
  troca:{nome:"Troca", verbo:"Registrar troca"},
  emprestimo:{nome:"Empréstimo", verbo:"Registrar empréstimo"},
  devolucao:{nome:"Devolução"}, ajuste:{nome:"Ajuste"}, estorno:{nome:"Estorno"}
};
const pill = t => `<span class="pill p-${esc(t)}">${esc(TIPOS[t]?.nome||t)}</span>`;
const norm = s => String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
const API = (window.ESTOQUE_API_URL || "").trim();

// ---------- estado ----------
const S = {
  usuario:"", nome:"", senha:"", perfil:"", perms:{}, rel:null, eq:null, dashPreset:"mes", itens:new Map(), emprestimos:[], movs:[],
  tab:"painel", tipo:"saida", picked:null, iStatus:"", hTipo:"", histMes:mesDe(), ocupado:false, ultima:null
};
const can = p => !!(S.perms && S.perms[p]);
const ABAS_PERM = {painel:["painel"], registrar:["registrar_saida","registrar_entrada","registrar_troca","registrar_emprestimo"], itens:["itens_ver"], historico:["historico_ver"], emprestimos:["devolver","registrar_emprestimo"], dashboard:["dashboard"], usuarios:["usuarios"]};
const podeAba = t => (ABAS_PERM[t]||[]).some(can);
const primeiraAba = () => Object.keys(ABAS_PERM).find(podeAba) || "painel";
const movsDoMes = ym => S.movs.filter(m => String(m.data).slice(0,7) === ym);

// ---------- sessão salva no aparelho ----------
const guardar = () => { try { localStorage.setItem("estoque-sessao", JSON.stringify({usuario:S.usuario, senha:S.senha})); } catch(e){} };
const lerSessao = () => { try { return JSON.parse(localStorage.getItem("estoque-sessao")||"null"); } catch(e){ return null; } };
const apagarSessao = () => { try { localStorage.removeItem("estoque-sessao"); } catch(e){} };

// ---------- comunicação com a planilha ----------
async function api(acao, extra){
  if (!API) throw {paraUsuario:true, message:"O endereço da planilha ainda não foi configurado (arquivo config.js)."};
  const corpo = Object.assign({acao, usuario:S.usuario, senha:S.senha, meses:[...new Set([mesDe(), S.histMes])]}, extra||{});
  let r;
  try {
    const resp = await fetch(API, {method:"POST", body:JSON.stringify(corpo), redirect:"follow"});
    r = await resp.json();
  } catch(e){
    throw {paraUsuario:true, message:"Sem conexão com a planilha. Verifique a internet e tente de novo."};
  }
  if (!r.ok) {
    if (r.codigo === "senha" && acao !== "entrar") { sair("A senha mudou. Entre de novo."); }
    throw {paraUsuario:true, message:r.erro || "Não foi possível concluir."};
  }
  if (r.perms) { S.perms = r.perms; aplicarPermissoes(); }
  if (r.perfil) S.perfil = r.perfil;
  if (r.nome) S.nome = r.nome;
  if (r.dados) aplicar(r.dados);
  return r;
}
function aplicar(d){
  S.itens = new Map((d.itens||[]).map(i => [i.id, i]));
  S.emprestimos = d.emprestimos || [];
  S.movs = d.movs || [];
  S.ultima = new Date();
  renderAll(); renderSugestoes();
}
async function atualizar(silencioso){
  if (S.ocupado || !S.senha) return;
  S.ocupado = true; renderSync();
  try { await api("dados"); }
  catch(e){ if (!silencioso) toast(e.message, true); }
  finally { S.ocupado = false; renderSync(); }
}
function renderSync(){
  const el = $("#sync"); if (!el) return;
  el.innerHTML = S.ocupado ? `<span class="spin" aria-hidden="true"></span> Atualizando…` : S.ultima ? `Atualizado às ${S.ultima.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}` : "";
}
setInterval(() => { if (document.visibilityState==="visible" && $("#modal").hidden && S.senha) atualizar(true); }, 45000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState==="visible" && S.senha && (!S.ultima || Date.now()-S.ultima > 20000)) atualizar(true); });

// ---------- avisos ----------
let toastT;
function toast(msg, err){ const t = $("#toast"); t.textContent = msg; t.className = "toast"+(err?" err":""); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(()=>t.hidden=true, err?5500:3000); }
function renderNotices(){
  $("#notices").innerHTML = API ? "" : `<div class="notice crit">O endereço da planilha ainda não foi configurado. Coloque o link do App da Web do Apps Script no arquivo <b>config.js</b>.</div>`;
}

// ---------- entrada ----------
function mostrarLogin(msg){
  $("#login").hidden = false;
  $("#l-usuario").value = S.usuario || "";
  $("#l-senha").value = "";
  $("#l-msg").textContent = msg || ""; $("#l-msg").className = msg ? "hint err" : "hint";
  ($("#l-usuario").value ? $("#l-senha") : $("#l-usuario")).focus();
}
function sair(msg){ S.senha = ""; S.perms = {}; S.rel = null; S.eq = null; apagarSessao(); mostrarLogin(msg); }
$("#f-login").addEventListener("submit", async ev => {
  ev.preventDefault();
  const usuario = $("#l-usuario").value.trim().toLowerCase(), senha = $("#l-senha").value.trim(), msg = $("#l-msg");
  if (!usuario) { msg.textContent = "Informe seu usuário."; msg.className = "hint err"; return; }
  if (!senha) { msg.textContent = "Informe a senha."; msg.className = "hint err"; return; }
  const btn = $("#l-entrar"); btn.disabled = true; msg.className = "hint"; msg.textContent = "Entrando…";
  S.usuario = usuario; S.senha = senha;
  try {
    await api("entrar");
    guardar(); $("#login").hidden = true; renderMe(); setTab(podeAba(S.tab) ? S.tab : primeiraAba()); atualizar();
  } catch(e){ S.senha = ""; msg.className = "hint err"; msg.textContent = e.message; }
  finally { btn.disabled = false; }
});

function renderMe(){
  $("#me").innerHTML = `<div style="text-align:right"><div class="who">${esc(S.nome)}</div><span class="role ${can("usuarios")?"adm":""}">${esc(S.perfil||"")}</span> <button class="sair" id="b-sair" type="button">Sair</button><div class="sync" id="sync"></div></div>`;
  $("#b-sair").onclick = () => sair("");
  renderSync();
}

// ---------- abas ----------
function setTab(t){
  if (S.senha && !podeAba(t)) t = primeiraAba();
  S.tab = t;
  $$("nav.tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab===t ? "true":"false"));
  $$("main > section").forEach(s => s.hidden = s.id !== "t-"+t);
  renderAll();
  if (t==="dashboard") carregarDashboard();
  if (t==="usuarios") carregarEquipe();
  window.scrollTo({top:0});
  try{ history.replaceState(null,"","#"+t); }catch(e){}
}
$$("nav.tabs button").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
$$(".kpi").forEach(k => k.addEventListener("click", () => {
  if (k.dataset.filter) { S.iStatus = k.dataset.filter; syncChips("#i-status","s",S.iStatus); }
  setTab(k.dataset.go);
}));
function syncChips(sel, key, val){ $$(sel+" .chip").forEach(c => c.setAttribute("aria-pressed", c.dataset[key]===val ? "true":"false")); }
document.addEventListener("click", e => {
  const g = e.target.closest("[data-go2]"); if (!g) return;
  if (g.dataset.f) { S.iStatus = g.dataset.f; syncChips("#i-status","s",S.iStatus); }
  setTab(g.dataset.go2);
});

// ---------- itens ----------
function statusItem(it){
  const q = Number(it.qtd)||0, m = Number(it.minimo)||0;
  if (q <= 0) return "zero";
  if (m > 0 && q < m) return "baixo";
  return "ok";
}
const precisaRepor = i => statusItem(i)!=="ok";
const stPill = s => s==="zero" ? `<span class="pill s-zero">Zerado</span>` : s==="baixo" ? `<span class="pill s-baixo">Abaixo do mín.</span>` : `<span class="pill s-ok">OK</span>`;
const itensArr = () => [...S.itens.values()].sort((a,b) => String(a.nome||"").localeCompare(String(b.nome||""),"pt-BR"));
function proxCodigo(){
  let max = 0;
  for (const it of S.itens.values()) { const m = /(\d+)\s*$/.exec(it.codigo||""); if (m) max = Math.max(max, +m[1]); }
  return "MAN-" + String(max+1).padStart(4,"0");
}
const ordMov = (a,b) => String(b.data||"").localeCompare(String(a.data||"")) || String(b.criadoEm||"").localeCompare(String(a.criadoEm||""));
const sinal = m => (Number(m.delta)>0?"+":Number(m.delta)<0?"−":"");

// ---------- painel ----------
function renderPainel(){
  const arr = itensArr();
  const cats = new Set(arr.map(i=>i.categoria).filter(Boolean));
  $("#k-itens").textContent = arr.length;
  $("#k-itens-sub").textContent = arr.length ? `${cats.size} categoria${cats.size===1?"":"s"}` : "nenhum item ainda";
  $("#dl-cat").innerHTML = [...cats].sort().map(c=>`<option value="${esc(c)}">`).join("");
  const baixos = arr.filter(precisaRepor);
  const zerados = baixos.filter(i => statusItem(i)==="zero").length;
  $("#k-baixo").textContent = baixos.length;
  $("#k-baixo-sub").textContent = baixos.length ? `${zerados} zerado${zerados===1?"":"s"}` : "tudo em ordem";
  $("#k-baixo-box").classList.toggle("crit", baixos.length>0);
  const atras = S.emprestimos.filter(e => e.previsao && e.previsao < hoje()).length;
  $("#k-emp").textContent = S.emprestimos.length;
  $("#k-emp-sub").textContent = atras ? `${atras} atrasado${atras===1?"":"s"}` : "nenhum atrasado";
  $("#k-emp-box").classList.toggle("warn", atras>0);
  const doMes = movsDoMes(mesDe());
  const saidas = doMes.filter(m => (m.tipo==="saida"||m.tipo==="troca") && !m.estornado);
  $("#k-saidas").textContent = saidas.length;
  $("#k-saidas-sub").textContent = "retiradas e trocas em " + MESES[new Date().getMonth()];
  $("#b-itens").textContent = arr.length;
  const be = $("#b-emp"); be.textContent = S.emprestimos.length; be.classList.toggle("alert", atras>0);

  const ult = [...doMes].sort(ordMov).slice(0,10);
  $("#p-ultimas").innerHTML = ult.length ? ult.map(m => `
    <div class="row"><div>${pill(m.tipo)}</div>
      <div><div class="t ${m.estornado?"struck":""}">${esc(m.itemNome)}</div><div class="d">${esc(descMov(m))}</div></div>
      <div class="r"><div class="num">${sinal(m)}${fNum(Math.abs(m.qtd))} ${esc(m.unidade||"")}</div><div class="d">${fData(m.data)}</div></div></div>`).join("")
    : `<div class="empty">Nenhuma movimentação neste mês. Use a aba <button class="link" data-go2="registrar">Registrar</button> quando alguém retirar, comprar, trocar ou emprestar um item.</div>`;

  const comp = [...baixos].sort((a,b) => ((a.qtd||0)-(a.minimo||0)) - ((b.qtd||0)-(b.minimo||0))).slice(0,8);
  $("#p-comprar").innerHTML = comp.length ? comp.map(i => `
    <div class="row"><div>${stPill(statusItem(i))}</div>
      <div><div class="t">${esc(i.nome)}</div><div class="d"><span class="mono">${esc(i.codigo||"")}</span>${i.local?" · "+esc(i.local):""}</div></div>
      <div class="r num">${fNum(i.qtd)} / ${fNum(i.minimo)} ${esc(i.unidade||"")}</div></div>`).join("")
    + (baixos.length>8 ? `<div class="empty"><button class="link" data-go2="itens" data-f="baixo">Ver todos os ${baixos.length}</button></div>`:"")
    : `<div class="empty">${arr.length ? "Nenhum item abaixo do estoque mínimo." : "Quando os itens forem cadastrados com estoque mínimo, os que precisam de reposição aparecem aqui."}</div>`;

  const cont = {};
  for (const m of saidas) { const k = String(m.destino||"Sem destino").trim(); cont[k] = (cont[k]||0)+1; }
  const top = Object.entries(cont).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const max = top.length ? top[0][1] : 1;
  $("#p-destinos").innerHTML = top.length ? top.map(([k,v]) => `
    <div class="bar"><span class="n" title="${esc(k)}">${esc(k)}</span><span class="track"><span class="fill" style="width:${Math.max(4,v/max*100)}%;display:block"></span></span><span class="v">${v}</span></div>`).join("")
    : `<div class="empty">As saídas e trocas do mês aparecem aqui agrupadas por destino.</div>`;
}
function descMov(m){
  const p = [];
  if (m.tipo==="entrada") { if (m.fornecedor) p.push(m.fornecedor); if (m.nf) p.push("NF "+m.nf); }
  else if (m.tipo==="devolucao") { p.push("devolvido por "+(m.responsavel||"—")); if (m.estadoDevolucao) p.push(String(m.estadoDevolucao).toLowerCase()); }
  else if (m.tipo==="ajuste") { p.push(m.motivo || "ajuste de inventário"); }
  else if (m.tipo==="estorno") { p.push("correção de lançamento"); if (m.motivo) p.push(m.motivo); }
  else { if (m.responsavel) p.push(m.responsavel); if (m.destino) p.push("→ "+m.destino); if (m.tipo==="troca" && m.velhoDestino) p.push("peça velha: "+String(m.velhoDestino).toLowerCase()); }
  if (m.estornado) p.push("estornado");
  return p.join(" · ");
}

// ---------- tela de itens ----------
function renderItens(){
  const q = norm($("#i-busca").value), cat = $("#i-cat").value;
  const all = itensArr();
  const cats = [...new Set(all.map(i=>i.categoria).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
  const sel = $("#i-cat"), cur = sel.value;
  sel.innerHTML = `<option value="">Todas as categorias</option>` + cats.map(c=>`<option ${c===cur?"selected":""}>${esc(c)}</option>`).join("");
  const list = all.filter(i => {
    if (cat && i.categoria!==cat) return false;
    const st = statusItem(i);
    if (S.iStatus==="baixo" && st==="ok") return false;
    if (S.iStatus==="zero" && st!=="zero") return false;
    if (q && !norm([i.nome,i.codigo,i.local,i.categoria].join(" ")).includes(q)) return false;
    return true;
  });
  $("#i-count").textContent = all.length ? `${list.length} de ${all.length} itens` : "";
  $("#i-body").innerHTML = list.length ? list.map(i => `
    <tr><td class="mono">${esc(i.codigo||"—")}</td>
    <td><b>${esc(i.nome)}</b><span class="sub">${esc(i.tipoItem||"")}</span></td>
    <td class="hide-m">${esc(i.categoria||"—")}</td>
    <td class="hide-s">${esc(i.local||"—")}</td>
    <td class="n"><b>${fNum(i.qtd)}</b> <span class="muted">${esc(i.unidade||"")}</span></td>
    <td class="n hide-s">${Number(i.minimo)>0?fNum(i.minimo):"—"}</td>
    <td>${stPill(statusItem(i))}</td>
    <td class="n"><button class="btn small" data-item="${esc(i.id)}">${can("itens_editar")?"Editar":"Ver"}</button></td></tr>`).join("")
    : `<tr><td colspan="8"><div class="empty">${all.length ? "Nenhum item com esses filtros." : (S.ultima ? "Nenhum item cadastrado ainda. Cadastre o primeiro em <b>Novo item</b>." : "Carregando os itens da planilha…")}</div></td></tr>`;
}
$("#i-busca").addEventListener("input", renderItens);
$("#i-cat").addEventListener("change", renderItens);
$$("#i-status .chip").forEach(c => c.addEventListener("click", () => { S.iStatus = c.dataset.s; syncChips("#i-status","s",S.iStatus); renderItens(); }));
$("#i-body").addEventListener("click", e => { const b = e.target.closest("[data-item]"); if (b) abrirItem(b.dataset.item); });
$("#i-novo").addEventListener("click", () => abrirItem(null));

// ---------- janelas ----------
function fecharModal(){ $("#modal").hidden = true; $("#modal-box").innerHTML = ""; }
$("#modal").addEventListener("click", e => { if (e.target.id==="modal") fecharModal(); });
document.addEventListener("keydown", e => { if (e.key==="Escape" && !$("#modal").hidden) fecharModal(); });
async function enviar(btn, msgEl, acao, extra, aoConcluir){
  if (btn) btn.disabled = true;
  if (msgEl) { msgEl.className = "hint"; msgEl.innerHTML = `<span class="spin" aria-hidden="true"></span> Salvando…`; }
  S.ocupado = true; renderSync();
  try {
    const r = await api(acao, extra);
    if (aoConcluir) aoConcluir(r);
    toast(r.msg || "Salvo.");
    return r;
  } catch(e){
    if (msgEl) { msgEl.className = "hint err"; msgEl.textContent = e.message || "Não foi possível salvar."; } else toast(e.message, true);
    return null;
  } finally { if (btn) btn.disabled = false; S.ocupado = false; renderSync(); }
}

function abrirItem(id, depois){
  const it = id ? S.itens.get(id) : null;
  const novo = !it, edit = novo ? can("itens_cadastrar") : can("itens_editar");
  const v = it || {codigo:proxCodigo(), nome:"", categoria:"", tipoItem:"Consumível", unidade:"un", local:"", qtd:"", minimo:"", obs:""};
  const ro = edit ? "" : "disabled";
  const unidades = ["un","pç","par","m","m²","kg","g","L","ml","cx","pct","rolo","galão","lata","jogo"];
  if (v.unidade && !unidades.includes(v.unidade)) unidades.push(v.unidade);
  const tipos = ["Consumível","Ferramenta","Peça de reposição","Equipamento","EPI"];
  if (v.tipoItem && !tipos.includes(v.tipoItem)) tipos.push(v.tipoItem);
  const numTxt = x => x===""||x==null ? "" : esc(String(x).replace(".",","));
  $("#modal-box").innerHTML = `
    <h3>${novo ? "Novo item" : edit ? "Editar item" : "Detalhes do item"}</h3>
    <form class="form" id="f-item" novalidate autocomplete="off">
      <div class="field"><label for="it-cod">Código</label><input class="input mono" id="it-cod" value="${esc(v.codigo)}" ${ro}></div>
      <div class="field"><label for="it-tipo">Tipo</label><select class="input" id="it-tipo" ${ro}>${tipos.map(o=>`<option ${o===v.tipoItem?"selected":""}>${esc(o)}</option>`).join("")}</select></div>
      <div class="field full"><label for="it-nome">Nome do item <span class="req">*</span></label><input class="input" id="it-nome" value="${esc(v.nome)}" placeholder="Ex.: Lâmpada LED tubular 18W" ${ro}></div>
      <div class="field"><label for="it-cat">Categoria</label><input class="input" id="it-cat" value="${esc(v.categoria)}" list="dl-cat" placeholder="Ex.: Elétrica" ${ro}></div>
      <div class="field"><label for="it-local">Local de guarda</label><input class="input" id="it-local" value="${esc(v.local)}" placeholder="Ex.: Prateleira A3" ${ro}></div>
      <div class="field"><label for="it-qtd">${novo?"Quantidade atual":"Estoque atual"}</label><input class="input num" id="it-qtd" inputmode="decimal" value="${numTxt(v.qtd)}" placeholder="0" ${ro}></div>
      <div class="field"><label for="it-un">Unidade</label><select class="input" id="it-un" ${ro}>${unidades.map(u=>`<option ${u===v.unidade?"selected":""}>${esc(u)}</option>`).join("")}</select></div>
      <div class="field"><label for="it-min">Estoque mínimo</label><input class="input num" id="it-min" inputmode="decimal" value="${Number(v.minimo)>0?numTxt(v.minimo):""}" placeholder="Avisa quando ficar abaixo" ${ro}></div>
      <div class="field" id="it-motivo-box" hidden><label for="it-motivo">Motivo da mudança no estoque <span class="req">*</span></label><input class="input" id="it-motivo" placeholder="Ex.: contagem do inventário"></div>
      <div class="field full"><label for="it-obs">Observação</label><textarea class="input" id="it-obs" ${ro}>${esc(v.obs||"")}</textarea></div>
      <div class="full actions">
        ${edit ? `<button class="btn primary" type="submit" id="it-salvar">${novo?"Cadastrar item":"Salvar alterações"}</button>`:""}
        <button class="btn" type="button" id="it-fechar">${edit?"Cancelar":"Fechar"}</button>
        ${!novo && edit ? `<button class="btn danger" type="button" id="it-del" style="margin-left:auto">Excluir item</button>`:""}
        <span class="hint" id="it-msg"></span>
      </div>
      <div class="full confirm" id="it-conf" hidden>
        <span>Excluir <b>${esc(v.nome)}</b> do cadastro? O histórico de movimentações continua guardado.</span>
        <div class="actions"><button class="btn danger" type="button" id="it-del-ok">Sim, excluir</button><button class="btn" type="button" id="it-del-no">Manter item</button></div>
      </div>
    </form>`;
  $("#modal").hidden = false;
  (edit ? $("#it-nome") : $("#it-fechar")).focus();
  $("#it-fechar").onclick = fecharModal;
  if (!novo && edit) {
    const orig = Number(it.qtd)||0;
    $("#it-qtd").addEventListener("input", () => { const q = pQtd($("#it-qtd").value); $("#it-motivo-box").hidden = !(Number.isFinite(q) && q !== orig); });
    $("#it-del").onclick = () => { $("#it-conf").hidden = false; };
    $("#it-del-no").onclick = () => { $("#it-conf").hidden = true; };
    $("#it-del-ok").onclick = () => enviar($("#it-del-ok"), $("#it-msg"), "excluirItem", {id:it.id}, fecharModal);
  }
  $("#f-item").addEventListener("submit", async ev => {
    ev.preventDefault(); if (!edit) return;
    const msg = $("#it-msg"); msg.className = "hint err";
    const nome = $("#it-nome").value.trim();
    if (!nome) { msg.textContent = "Informe o nome do item."; return; }
    const qtdTxt = $("#it-qtd").value.trim(), qtd = qtdTxt==="" ? 0 : pQtd(qtdTxt);
    if (!Number.isFinite(qtd) || qtd < 0) { msg.textContent = "Quantidade inválida."; return; }
    const minTxt = $("#it-min").value.trim(), minimo = minTxt==="" ? 0 : pQtd(minTxt);
    if (!Number.isFinite(minimo) || minimo < 0) { msg.textContent = "Estoque mínimo inválido."; return; }
    const codigo = $("#it-cod").value.trim();
    const dup = codigo && [...S.itens.values()].find(x => x.codigo===codigo && x.id!==(it&&it.id));
    if (dup) { msg.textContent = `O código ${codigo} já é usado por "${dup.nome}".`; return; }
    let motivo = "";
    if (!novo && qtd !== (Number(it.qtd)||0)) { motivo = $("#it-motivo").value.trim(); if (!motivo) { msg.textContent = "Explique o motivo da mudança no estoque."; return; } }
    const item = { id: it ? it.id : "", codigo, nome, categoria:$("#it-cat").value.trim(), tipoItem:$("#it-tipo").value, unidade:$("#it-un").value, local:$("#it-local").value.trim(), qtd, minimo, obs:$("#it-obs").value.trim() };
    const antes = new Set(S.itens.keys());
    await enviar($("#it-salvar"), msg, "salvarItem", {item, motivo}, () => {
      fecharModal();
      if (depois) { const novoId = [...S.itens.keys()].find(k => !antes.has(k)); if (novoId) depois(novoId); }
    });
  });
}

// ---------- registrar ----------
function setTipo(t){
  S.tipo = t;
  $$("#seg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.tipo===t?"true":"false"));
  $$("#f-mov [data-for]").forEach(f => f.hidden = !f.dataset.for.split(" ").includes(t));
  $("#m-enviar").textContent = TIPOS[t].verbo;
  $("#m-resp-lbl").innerHTML = (t==="emprestimo" ? "Com quem fica" : t==="troca" ? "Quem fez a troca" : "Quem retirou") + ' <span class="req">*</span>';
  $("#m-destino-lbl").innerHTML = (t==="troca" ? "Onde foi instalada (local ou equipamento)" : t==="emprestimo" ? "Onde vai ser usada" : "Destino (setor, local ou equipamento)") + ' <span class="req">*</span>';
  $("#m-msg").textContent = ""; $("#m-msg").className = "hint";
  renderPicked();
}
$$("#seg button").forEach(b => b.addEventListener("click", () => setTipo(b.dataset.tipo)));

let comboHl = -1, comboRes = [];
function renderCombo(){
  const q = norm($("#m-busca").value), box = $("#m-lista");
  if (!q) { box.hidden = true; $("#m-busca").setAttribute("aria-expanded","false"); return; }
  comboRes = itensArr().filter(i => norm(i.nome+" "+(i.codigo||"")+" "+(i.categoria||"")).includes(q)).slice(0,30);
  box.innerHTML = comboRes.length ? comboRes.map((i,k) => `<button type="button" role="option" data-id="${esc(i.id)}" class="${k===comboHl?"hl":""}"><span class="mono muted">${esc(i.codigo||"")}</span><span>${esc(i.nome)}</span><span class="num muted">${fNum(i.qtd)} ${esc(i.unidade||"")}</span></button>`).join("")
    : `<div class="empty" style="padding:10px 12px">Nenhum item encontrado. <button type="button" class="link" id="m-novo2">Cadastrar “${esc($("#m-busca").value.trim())}”</button></div>`;
  box.hidden = false; $("#m-busca").setAttribute("aria-expanded","true");
}
$("#m-busca").addEventListener("input", () => { comboHl = -1; renderCombo(); });
$("#m-busca").addEventListener("keydown", e => {
  if ($("#m-lista").hidden) return;
  if (e.key==="ArrowDown") { e.preventDefault(); comboHl = Math.min(comboRes.length-1, comboHl+1); renderCombo(); }
  else if (e.key==="ArrowUp") { e.preventDefault(); comboHl = Math.max(0, comboHl-1); renderCombo(); }
  else if (e.key==="Enter") { e.preventDefault(); const it = comboRes[comboHl<0?0:comboHl]; if (it) pick(it.id); }
  else if (e.key==="Escape") { $("#m-lista").hidden = true; }
});
$("#m-lista").addEventListener("click", e => {
  const b = e.target.closest("[data-id]"); if (b) { pick(b.dataset.id); return; }
  if (e.target.id==="m-novo2") novoDoRegistro($("#m-busca").value.trim());
});
document.addEventListener("click", e => { if (!e.target.closest(".combo")) $("#m-lista").hidden = true; });
function pick(id){ S.picked = id; $("#m-busca").value = ""; $("#m-lista").hidden = true; renderPicked(); $("#m-qtd").focus(); }
function renderPicked(){
  const it = S.picked && S.itens.get(S.picked), box = $("#m-picked");
  if (!it) { box.hidden = true; $("#m-busca").hidden = false; return; }
  $("#m-busca").hidden = true; box.hidden = false;
  box.innerHTML = `<span><span class="mono muted">${esc(it.codigo||"")}</span> <b>${esc(it.nome)}</b></span><span class="num">Em estoque: <b>${fNum(it.qtd)} ${esc(it.unidade||"")}</b> ${stPill(statusItem(it))} <button type="button" class="link" id="m-trocar" style="margin-left:8px">Trocar item</button></span>`;
  $("#m-trocar").onclick = () => { S.picked = null; renderPicked(); $("#m-busca").focus(); };
}
function novoDoRegistro(nome){ if (!can("itens_cadastrar")) return; abrirItem(null, id => pick(id)); if (nome) $("#it-nome").value = nome; }
$("#m-novo").addEventListener("click", () => novoDoRegistro(""));

$("#f-mov").addEventListener("submit", async ev => {
  ev.preventDefault();
  const msg = $("#m-msg"); msg.className = "hint err";
  const it = S.picked && S.itens.get(S.picked);
  if (!it) { msg.textContent = "Escolha o item."; return; }
  const qtd = pQtd($("#m-qtd").value || "1");
  if (!Number.isFinite(qtd) || qtd <= 0) { msg.textContent = "Informe uma quantidade maior que zero."; return; }
  const t = S.tipo, data = $("#m-data").value || hoje();
  const resp = $("#m-resp").value.trim(), destino = $("#m-destino").value.trim();
  if (t!=="entrada") {
    if (!resp) { msg.textContent = t==="emprestimo" ? "Informe com quem a ferramenta vai ficar." : "Informe quem retirou."; return; }
    if (!destino) { msg.textContent = "Informe o destino."; return; }
    if (qtd > (Number(it.qtd)||0)) { msg.textContent = `Estoque insuficiente: há ${fNum(it.qtd)} ${it.unidade||""}. Se a contagem estiver errada, a administração pode ajustar o item.`; return; }
  }
  if (t==="troca" && !$("#m-velho").value) { msg.textContent = "Informe o que foi feito com a peça retirada."; return; }
  const valorTxt = $("#m-valor").value.trim(), valor = valorTxt ? pQtd(valorTxt) : "";
  if (t==="entrada" && valorTxt && !Number.isFinite(valor)) { msg.textContent = "Valor unitário inválido."; return; }
  const mov = { tipo:t, itemId:it.id, qtd, data, obs:$("#m-obs").value.trim() };
  if (t==="entrada") Object.assign(mov, { fornecedor:$("#m-forn").value.trim(), nf:$("#m-nf").value.trim(), valorUnit:valor, responsavel:$("#m-recebeu").value.trim() });
  else Object.assign(mov, { responsavel:resp, destino, motivo: t==="emprestimo" ? "" : $("#m-os").value.trim() });
  if (t==="troca") mov.velhoDestino = $("#m-velho").value;
  if (t==="emprestimo") mov.previsao = $("#m-prev").value || "";
  const r = await enviar($("#m-enviar"), msg, "registrar", {mov});
  if (r) {
    ["m-qtd","m-obs","m-os","m-nf","m-valor","m-prev"].forEach(id => $("#"+id).value = "");
    $("#m-velho").value = ""; msg.textContent = "";
    S.picked = null; renderPicked(); $("#m-busca").focus();
  }
});
function renderSugestoes(){
  const uniq = arr => [...new Set(arr.filter(Boolean).map(s=>String(s).trim()))].sort((a,b)=>a.localeCompare(b,"pt-BR")).slice(0,200);
  $("#dl-resp").innerHTML = uniq(S.movs.map(m=>m.responsavel)).map(v=>`<option value="${esc(v)}">`).join("");
  $("#dl-dest").innerHTML = uniq(S.movs.map(m=>m.destino)).map(v=>`<option value="${esc(v)}">`).join("");
  $("#dl-forn").innerHTML = uniq(S.movs.map(m=>m.fornecedor)).map(v=>`<option value="${esc(v)}">`).join("");
}

// ---------- histórico ----------
function renderHist(){
  const q = norm($("#h-busca").value);
  const all = movsDoMes(S.histMes).sort(ordMov);
  const list = all.filter(m => {
    if (S.hTipo && m.tipo!==S.hTipo && !(S.hTipo==="ajuste" && m.tipo==="estorno")) return false;
    if (q && !norm([m.itemNome,m.itemCodigo,m.responsavel,m.destino,m.motivo,m.fornecedor,m.nf,m.obs,m.registradoPor].join(" ")).includes(q)) return false;
    return true;
  });
  const val = all.filter(m=>!m.estornado);
  const c = t => val.filter(m=>m.tipo===t).length;
  const gasto = val.filter(m=>m.tipo==="entrada" && m.valorUnit!=="" && Number.isFinite(Number(m.valorUnit))).reduce((s,m)=>s+Number(m.valorUnit)*Number(m.qtd),0);
  $("#h-sum").innerHTML = `<span>${nomeMes(S.histMes)}</span><span><b>${c("saida")}</b> saídas</span><span><b>${c("entrada")}</b> entradas</span><span><b>${c("troca")}</b> trocas</span><span><b>${c("emprestimo")}</b> empréstimos</span><span>Compras: <b>${fBRL(gasto)}</b></span>`;
  $("#h-csv").hidden = !can("exportar");
  const admin = can("historico_estornar");
  $("#h-body").innerHTML = list.length ? list.map(m => `
    <tr class="${m.estornado?"struck":""}"><td class="num" style="white-space:nowrap">${fData(m.data)}</td>
    <td>${pill(m.tipo)}</td>
    <td><b>${esc(m.itemNome)}</b><span class="sub mono">${esc(m.itemCodigo||"")}</span></td>
    <td class="n">${sinal(m)}${fNum(m.qtd)} <span class="muted">${esc(m.unidade||"")}</span></td>
    <td>${esc(m.tipo==="entrada" ? [m.fornecedor, m.nf?"NF "+m.nf:"", m.valorUnit!==""&&m.valorUnit!=null?fBRL(m.valorUnit)+"/un":""].filter(Boolean).join(" · ") : m.destino || "")}
      <span class="sub">${esc([m.motivo, m.tipo==="troca"&&m.velhoDestino?"Peça velha: "+m.velhoDestino:"", m.tipo==="emprestimo"&&m.previsao?"Devolver até "+fData(m.previsao):"", m.estadoDevolucao||"", m.obs].filter(Boolean).join(" · "))}</span></td>
    <td class="hide-s">${esc(m.responsavel||"—")}</td>
    <td class="hide-m">${esc(m.registradoPor||"—")}</td>
    <td class="n">${admin && !m.estornado && m.tipo!=="estorno" ? `<button class="btn small" data-est="${esc(m.id)}">Estornar</button>`:""}</td></tr>`).join("")
    : `<tr><td colspan="8"><div class="empty">${all.length ? "Nada encontrado com esses filtros." : "Nenhuma movimentação registrada em "+nomeMes(S.histMes)+"."}</div></td></tr>`;
}
$("#h-mes").value = S.histMes;
$("#h-mes").addEventListener("change", () => { S.histMes = $("#h-mes").value || mesDe(); renderHist(); atualizar(); });
$("#h-busca").addEventListener("input", renderHist);
$$("#h-tipos .chip").forEach(c => c.addEventListener("click", () => { S.hTipo = c.dataset.t; syncChips("#h-tipos","t",S.hTipo); renderHist(); }));
$("#h-body").addEventListener("click", e => { const b = e.target.closest("[data-est]"); if (b) abrirEstorno(b.dataset.est); });

function abrirEstorno(id){
  const m = S.movs.find(x=>x.id===id); if (!m) return;
  const d = Number(m.delta)||0;
  $("#modal-box").innerHTML = `
    <h3>Estornar lançamento</h3>
    <p>${pill(m.tipo)} <b>${fNum(m.qtd)} ${esc(m.unidade||"")}</b> de <b>${esc(m.itemNome)}</b> em ${fData(m.data)}${m.responsavel?" · "+esc(m.responsavel):""}</p>
    <p class="muted">${d===0 ? "O estoque não muda; o lançamento fica no histórico riscado." : `O lançamento fica no histórico riscado e o estoque ${d>0?"diminui":"aumenta"} ${fNum(Math.abs(d))}.`}</p>
    <form class="form" id="f-est" novalidate>
      <div class="field full"><label for="es-motivo">Motivo <span class="req">*</span></label><input class="input" id="es-motivo" placeholder="Ex.: lançado em duplicidade"></div>
      <div class="full actions"><button class="btn primary" type="submit" id="es-ok">Confirmar estorno</button><button class="btn" type="button" id="es-no">Cancelar</button><span class="hint" id="es-msg"></span></div>
    </form>`;
  $("#modal").hidden = false; $("#es-motivo").focus();
  $("#es-no").onclick = fecharModal;
  $("#f-est").addEventListener("submit", ev => {
    ev.preventDefault();
    const motivo = $("#es-motivo").value.trim();
    if (!motivo) { $("#es-msg").textContent = "Informe o motivo."; $("#es-msg").className="hint err"; return; }
    enviar($("#es-ok"), $("#es-msg"), "estornar", {movId:m.id, motivo}, fecharModal);
  });
}

$("#h-csv").addEventListener("click", () => {
  const list = movsDoMes(S.histMes).sort(ordMov);
  const cols = ["Data","Tipo","Código","Item","Quantidade","Unidade","Efeito no estoque","Responsável","Destino","OS / motivo","Peça retirada","Fornecedor","NF","Valor unitário","Previsão devolução","Estado na devolução","Observação","Registrado por","Estornado"];
  const cell = v => { const s = String(v ?? ""); return /[";\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const n = v => v===""||v==null ? "" : String(v).replace(".",",");
  const lines = [cols.join(";")].concat(list.map(m => [fData(m.data), TIPOS[m.tipo]?.nome||m.tipo, m.itemCodigo, m.itemNome, n(m.qtd), m.unidade, n(m.delta), m.responsavel, m.destino, m.motivo, m.velhoDestino, m.fornecedor, m.nf, n(m.valorUnit), m.previsao?fData(m.previsao):"", m.estadoDevolucao, m.obs, m.registradoPor, m.estornado?"sim":""].map(cell).join(";")));
  const blob = new Blob(["﻿"+lines.join("\r\n")], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `movimentacoes-${S.histMes}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});

// ---------- empréstimos ----------
function renderEmp(){
  const list = [...S.emprestimos].sort((a,b)=>String(a.previsao||"9999").localeCompare(String(b.previsao||"9999")));
  $("#e-body").innerHTML = list.length ? list.map(e => {
    const atras = e.previsao && e.previsao < hoje();
    return `<tr><td><b>${esc(e.itemNome)}</b><span class="sub mono">${esc(e.itemCodigo||"")}</span></td>
      <td class="n">${fNum(e.qtd)} <span class="muted">${esc(e.unidade||"")}</span></td>
      <td>${esc(e.responsavel)}</td><td class="hide-s">${esc(e.destino||"—")}</td>
      <td class="num">${fData(e.data)}</td>
      <td>${e.previsao ? (atras ? `<span class="pill s-zero">Atrasado · ${fData(e.previsao)}</span>` : `<span class="num">${fData(e.previsao)}</span>`) : `<span class="muted">sem data</span>`}</td>
      <td class="n">${can("devolver")?`<button class="btn small" data-dev="${esc(e.id)}">Registrar devolução</button>`:""}</td></tr>`;
  }).join("") : `<tr><td colspan="7"><div class="empty">Nenhuma ferramenta emprestada no momento. Empréstimos registrados na aba Registrar aparecem aqui até serem devolvidos.</div></td></tr>`;
}
$("#e-body").addEventListener("click", e => { const b = e.target.closest("[data-dev]"); if (b) abrirDevolucao(b.dataset.dev); });
function abrirDevolucao(id){
  const e = S.emprestimos.find(x=>x.id===id); if (!e) return;
  $("#modal-box").innerHTML = `
    <h3>Registrar devolução</h3>
    <p><b>${fNum(e.qtd)} ${esc(e.unidade||"")}</b> de <b>${esc(e.itemNome)}</b> · com ${esc(e.responsavel)} desde ${fData(e.data)}</p>
    <form class="form" id="f-dev" novalidate>
      <div class="field"><label for="dv-estado">Como voltou</label><select class="input" id="dv-estado"><option>Em bom estado</option><option>Danificada</option><option>Não voltou (perdida)</option></select></div>
      <div class="field"><label for="dv-data">Data da devolução</label><input class="input" id="dv-data" type="date" value="${hoje()}"></div>
      <div class="field full"><label for="dv-obs">Observação</label><input class="input" id="dv-obs" placeholder="Opcional"></div>
      <p class="hint full" id="dv-hint">A quantidade volta para o estoque.</p>
      <div class="full actions"><button class="btn primary" type="submit" id="dv-ok">Confirmar devolução</button><button class="btn" type="button" id="dv-no">Cancelar</button><span class="hint" id="dv-msg"></span></div>
    </form>`;
  $("#modal").hidden = false;
  $("#dv-no").onclick = fecharModal;
  $("#dv-estado").addEventListener("change", () => { const v = $("#dv-estado").value; $("#dv-hint").textContent = v.startsWith("Não voltou") ? "A ferramenta sai do estoque de vez e o caso fica registrado no histórico." : v==="Danificada" ? "A quantidade volta para o estoque. Avalie se precisa de conserto." : "A quantidade volta para o estoque."; });
  $("#f-dev").addEventListener("submit", ev => {
    ev.preventDefault();
    enviar($("#dv-ok"), $("#dv-msg"), "devolver", {emprestimoId:e.id, estado:$("#dv-estado").value, data:$("#dv-data").value||hoje(), obs:$("#dv-obs").value.trim()}, fecharModal);
  });
}

function renderAll(){
  renderPainel();
  if (S.tab==="itens") renderItens();
  if (S.tab==="historico") renderHist();
  if (S.tab==="emprestimos") renderEmp();
  if (S.tab==="dashboard") renderDash();
  renderPicked();
}

// ---------- permissões na tela ----------
function aplicarPermissoes(){
  $$("nav.tabs button").forEach(b => b.hidden = !podeAba(b.dataset.tab));
  const tipos = {saida:"registrar_saida", entrada:"registrar_entrada", troca:"registrar_troca", emprestimo:"registrar_emprestimo"};
  $$("#seg button").forEach(b => b.hidden = !can(tipos[b.dataset.tipo]));
  if (!can(tipos[S.tipo])) { const t = Object.keys(tipos).find(k => can(tipos[k])); if (t) setTipo(t); }
  $("#i-novo").hidden = !can("itens_cadastrar");
  $("#m-novo").closest(".hint").hidden = !can("itens_cadastrar");
  $$(".kpi[data-go]").forEach(k => k.disabled = !podeAba(k.dataset.go));
}

// ---------- dica flutuante dos gráficos ----------
const tipEl = document.createElement("div"); tipEl.className = "viz-tip"; tipEl.hidden = true; tipEl.setAttribute("role","status"); document.body.appendChild(tipEl);
function mostrarTip(alvo, x, y){
  let d; try { d = JSON.parse(alvo.dataset.tip); } catch(e){ return; }
  tipEl.textContent = "";
  const t = document.createElement("div"); t.className = "viz-tip-t"; t.textContent = d.t; tipEl.appendChild(t);
  (d.r||[]).forEach(([rot, val, cor]) => {
    const l = document.createElement("div"); l.className = "viz-tip-r";
    if (cor) { const k = document.createElement("span"); k.className = "viz-key"; k.style.background = `var(${cor})`; l.appendChild(k); }
    const v = document.createElement("b"); v.textContent = val; l.appendChild(v);
    const s = document.createElement("span"); s.textContent = rot; l.appendChild(s);
    tipEl.appendChild(l);
  });
  tipEl.hidden = false;
  const r = tipEl.getBoundingClientRect(), W = document.documentElement.clientWidth;
  tipEl.style.left = Math.max(8, Math.min(W - r.width - 8, x + 14)) + "px";
  tipEl.style.top = Math.max(8, y - r.height - 12) + "px";
}
document.addEventListener("pointermove", e => { const a = e.target.closest("[data-tip]"); if (a) mostrarTip(a, e.clientX, e.clientY); else tipEl.hidden = true; });
document.addEventListener("focusin", e => { const a = e.target.closest("[data-tip]"); if (a) { const b = a.getBoundingClientRect(); mostrarTip(a, b.left + b.width/2, b.top); } });
document.addEventListener("focusout", () => { tipEl.hidden = true; });
document.addEventListener("scroll", () => { tipEl.hidden = true; }, {passive:true});
const tipAttr = (t, r) => esc(JSON.stringify({t, r}));

// barras horizontais (uma série): rótulo, barra e valor na ponta
function barras(sel, linhas, vazio){
  const el = $(sel);
  if (!linhas.length) { el.innerHTML = `<div class="empty">${esc(vazio)}</div>`; return; }
  const max = Math.max(...linhas.map(l => l.v)) || 1;
  el.innerHTML = linhas.map(l => `<div class="hb" tabindex="0" data-tip="${tipAttr(l.rotulo, l.tip || [[l.unid||"", l.txt]])}">
    <span class="hb-l" title="${esc(l.rotulo)}">${esc(l.rotulo)}</span>
    <span class="hb-t"><span class="hb-f" style="width:${Math.max(1.5, l.v/max*100)}%"></span></span>
    <span class="hb-v num">${esc(l.txt)}</span></div>`).join("");
}
function topN(mapa, n){ return Object.entries(mapa).sort((a,b) => b[1].v - a[1].v || a[0].localeCompare(b[0],"pt-BR")).slice(0, n); }
function niceMax(v){ if (v <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1,2,2.5,5,10]) if (m*p >= v) return m*p; return 10*p; }

// ---------- dashboard ----------
const iso = d => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
function periodo(preset){
  const h = new Date(), y = h.getFullYear(), m = h.getMonth();
  switch (preset) {
    case "mesPassado": return [iso(new Date(y, m-1, 1)), iso(new Date(y, m, 0))];
    case "3m": return [iso(new Date(y, m-2, 1)), iso(h)];
    case "6m": return [iso(new Date(y, m-5, 1)), iso(h)];
    case "ano": return [iso(new Date(y, 0, 1)), iso(h)];
    case "pers": return [$("#d-de").value || iso(new Date(y, m, 1)), $("#d-ate").value || iso(h)];
    default: return [iso(new Date(y, m, 1)), iso(h)];
  }
}
let dashTok = 0;
async function carregarDashboard(){
  if (!can("dashboard") || !S.senha) return;
  const [de, ate] = periodo(S.dashPreset);
  if (S.dashPreset !== "pers") { $("#d-de").value = de; $("#d-ate").value = ate; }
  const tok = ++dashTok;
  $("#t-dashboard").classList.add("carregando");
  try {
    const r = await api("relatorio", {de, ate});
    if (tok === dashTok) { S.rel = r.relatorio; renderDash(); }
  } catch(e){ toast(e.message, true); }
  finally { if (tok === dashTok) $("#t-dashboard").classList.remove("carregando"); }
}
$$("#d-presets .chip").forEach(c => c.addEventListener("click", () => {
  S.dashPreset = c.dataset.p; syncChips("#d-presets","p",S.dashPreset);
  $("#d-pers").hidden = S.dashPreset !== "pers";
  carregarDashboard();
}));
["#d-de","#d-ate"].forEach(s => $(s).addEventListener("change", () => { if (S.dashPreset === "pers") carregarDashboard(); }));

function renderDash(){
  const R = S.rel;
  if (!R) { $("#d-resumo").textContent = "Carregando os dados do período…"; return; }
  const diasPer = Math.round((new Date(R.ate) - new Date(R.de)) / 864e5) + 1;
  $("#d-resumo").textContent = `De ${fData(R.de)} a ${fData(R.ate)} · ${diasPer} dia${diasPer===1?"":"s"}`;
  const movs = R.movs.filter(m => !m.estornado && m.tipo !== "estorno");
  const itens = R.itens, porId = new Map(itens.map(i => [i.id, i]));
  const ret = movs.filter(m => m.tipo==="saida" || m.tipo==="troca");
  const ent = movs.filter(m => m.tipo==="entrada");
  const emp = movs.filter(m => m.tipo==="emprestimo");
  const gasto = ent.reduce((s,m) => s + (m.valorUnit!=="" && m.valorUnit!=null ? Number(m.valorUnit)*Number(m.qtd) : 0), 0);
  const uRet = ret.reduce((s,m) => s + Number(m.qtd||0), 0);
  const atras = R.emprestimos.filter(e => e.previsao && e.previsao < hoje());
  const baixos = itens.filter(precisaRepor);
  let valorEst = 0, comPreco = 0;
  itens.forEach(i => { const p = R.preco[i.id]; if (p) { comPreco++; valorEst += p * (Number(i.qtd)||0); } });
  const mexidos = new Set(movs.map(m => m.itemId));
  const parados = itens.filter(i => Number(i.qtd) > 0 && !mexidos.has(i.id));

  const kpi = (lbl, val, sub, cls) => `<div class="kpi static ${cls||""}"><span class="lbl">${lbl}</span><span class="val">${val}</span><span class="sub">${sub}</span></div>`;
  $("#d-kpis").innerHTML = [
    kpi("Retiradas", ret.length, `${fNum(uRet)} unidade${uRet===1?"":"s"} · saídas e trocas`),
    kpi("Compras", fBRL(gasto), `${ent.length} entrada${ent.length===1?"":"s"} registrada${ent.length===1?"":"s"}`),
    kpi("Empréstimos", emp.length, `${R.emprestimos.length} em aberto agora${atras.length?` · ${atras.length} atrasado${atras.length===1?"":"s"}`:""}`, atras.length?"warn":""),
    kpi("Abaixo do mínimo", baixos.length, `${baixos.filter(i=>statusItem(i)==="zero").length} zerados hoje`, baixos.length?"crit":""),
    kpi("Valor estimado do estoque", fBRL(valorEst), `${comPreco} de ${itens.length} itens com preço de compra`),
    kpi("Itens parados", parados.length, "com estoque e sem movimento no período")
  ].join("");

  graficoMeses(ret, ent, R.de, R.ate);

  const somar = (lista, chave, valor) => { const o = {}; lista.forEach(m => { const k = String(chave(m)||"").trim() || "Não informado"; o[k] = o[k] || {v:0, n:0, u:0}; o[k].v += valor(m); o[k].n++; o[k].u += Number(m.qtd||0); }); return o; };
  const un = i => (porId.get(i)||{}).unidade || "";
  // itens mais retirados (unidades)
  const porItem = {}; ret.forEach(m => { const k = m.itemNome; porItem[k] = porItem[k] || {v:0, n:0, unid: m.unidade}; porItem[k].v += Number(m.qtd||0); porItem[k].n++; });
  barras("#d-itens", topN(porItem, 10).map(([k,o]) => ({rotulo:k, v:o.v, txt:`${fNum(o.v)} ${o.unid||""}`.trim(), tip:[["unidades retiradas", fNum(o.v)+" "+(o.unid||"")], ["retiradas", String(o.n)]]})), "Nenhuma retirada no período.");
  const dest = somar(ret, m => m.destino, () => 1);
  barras("#d-destinos", topN(dest, 10).map(([k,o]) => ({rotulo:k, v:o.v, txt:String(o.v), tip:[["retiradas", String(o.v)]]})), "Nenhuma retirada no período.");
  const resp = somar(ret.concat(emp), m => m.responsavel, () => 1);
  barras("#d-colab", topN(resp, 10).map(([k,o]) => ({rotulo:k, v:o.v, txt:String(o.v), tip:[["retiradas e empréstimos", String(o.v)]]})), "Ninguém retirou itens no período.");
  const cat = somar(ret, m => (porId.get(m.itemId)||{}).categoria, m => Number(m.qtd||0));
  barras("#d-cat", topN(cat, 10).map(([k,o]) => ({rotulo:k, v:o.v, txt:`${fNum(o.v)} un.`, tip:[["unidades retiradas", fNum(o.v)], ["retiradas", String(o.n)]]})), "Nenhuma retirada no período.");
  const forn = somar(ent, m => m.fornecedor, m => (m.valorUnit!==""&&m.valorUnit!=null) ? Number(m.valorUnit)*Number(m.qtd) : 0);
  barras("#d-forn", topN(forn, 10).map(([k,o]) => ({rotulo:k, v:o.v, txt:fBRL(o.v), tip:[["em compras", fBRL(o.v)], ["entradas", String(o.n)]]})), "Nenhuma compra registrada no período.");
  const troc = somar(movs.filter(m => m.tipo==="troca"), m => m.velhoDestino, () => 1);
  barras("#d-trocas", topN(troc, 10).map(([k,o]) => ({rotulo:k, v:o.v, txt:String(o.v), tip:[["peças", String(o.v)]]})), "Nenhuma troca no período.");
  const quem = somar(R.movs, m => m.registradoPor, () => 1);
  barras("#d-usuarios", topN(quem, 10).map(([k,o]) => ({rotulo:k, v:o.v, txt:String(o.v), tip:[["lançamentos", String(o.v)]]})), "Nenhum lançamento no período.");

  // empréstimos em aberto
  const dias = d => Math.max(0, Math.round((new Date(hoje()) - new Date(d)) / 864e5));
  const abertos = [...R.emprestimos].sort((a,b) => String(a.data).localeCompare(String(b.data)));
  $("#d-emp").innerHTML = abertos.length ? abertos.map(e => `<tr><td><b>${esc(e.itemNome)}</b><span class="sub mono">${esc(e.itemCodigo||"")}</span></td><td>${esc(e.responsavel)}</td><td class="n">${dias(e.data)} dia${dias(e.data)===1?"":"s"}</td><td>${e.previsao ? (e.previsao < hoje() ? `<span class="pill s-zero">Atrasado · ${fData(e.previsao)}</span>` : fData(e.previsao)) : '<span class="muted">sem data</span>'}</td></tr>`).join("")
    : `<tr><td colspan="4"><div class="empty">Nenhuma ferramenta fora do almoxarifado agora.</div></td></tr>`;
  // estoque crítico
  $("#d-crit").innerHTML = baixos.length ? baixos.sort((a,b) => (Number(a.qtd)-Number(a.minimo)) - (Number(b.qtd)-Number(b.minimo))).map(i => `<tr><td><b>${esc(i.nome)}</b><span class="sub mono">${esc(i.codigo||"")}</span></td><td class="n">${fNum(i.qtd)} / ${fNum(i.minimo)} ${esc(i.unidade||"")}</td><td>${stPill(statusItem(i))}</td></tr>`).join("")
    : `<tr><td colspan="3"><div class="empty">Nenhum item abaixo do mínimo. Defina o estoque mínimo dos itens para receber esse alerta.</div></td></tr>`;
  // parados
  const par = parados.sort((a,b) => String(R.ultimo[a.id]||"").localeCompare(String(R.ultimo[b.id]||"")) || Number(b.qtd)-Number(a.qtd)).slice(0, 15);
  $("#d-parados").innerHTML = par.length ? par.map(i => `<tr><td><b>${esc(i.nome)}</b><span class="sub mono">${esc(i.codigo||"")}</span></td><td class="n">${fNum(i.qtd)} ${esc(i.unidade||"")}</td><td>${R.ultimo[i.id] ? fData(R.ultimo[i.id]) : '<span class="muted">nunca</span>'}</td></tr>`).join("")
    + (parados.length > 15 ? `<tr><td colspan="3"><div class="empty">Mais ${parados.length-15} itens parados no período.</div></td></tr>` : "")
    : `<tr><td colspan="3"><div class="empty">Todos os itens com estoque tiveram movimento no período.</div></td></tr>`;

  // consumo detalhado por item
  const det = {};
  movs.forEach(m => {
    const d = det[m.itemId] = det[m.itemId] || {id:m.itemId, nome:m.itemNome, codigo:m.itemCodigo, unidade:m.unidade, saida:0, troca:0, entrada:0, emp:0, gasto:0};
    if (m.tipo==="saida") d.saida += Number(m.qtd||0);
    if (m.tipo==="troca") d.troca += Number(m.qtd||0);
    if (m.tipo==="emprestimo") d.emp += Number(m.qtd||0);
    if (m.tipo==="entrada") { d.entrada += Number(m.qtd||0); if (m.valorUnit!==""&&m.valorUnit!=null) d.gasto += Number(m.valorUnit)*Number(m.qtd); }
  });
  S.detalhe = Object.values(det).map(d => Object.assign(d, {cat:(porId.get(d.id)||{}).categoria||"", estoque:(porId.get(d.id)||{}).qtd, ultimo:R.ultimo[d.id]||""}))
    .sort((a,b) => (b.saida+b.troca) - (a.saida+a.troca) || b.entrada - a.entrada);
  $("#d-csv").hidden = !can("exportar");
  const lim = S.detTodos ? S.detalhe.length : 25;
  $("#d-mais").hidden = S.detalhe.length <= 25;
  $("#d-mais").textContent = S.detTodos ? "Mostrar só os 25 primeiros" : `Mostrar todos os ${S.detalhe.length} itens`;
  $("#d-det").innerHTML = S.detalhe.length ? S.detalhe.slice(0, lim).map(d => `<tr><td class="mono">${esc(d.codigo||"")}</td><td><b>${esc(d.nome)}</b><span class="sub">${esc(d.cat)}</span></td>
    <td class="n">${d.saida?fNum(d.saida):"—"}</td><td class="n">${d.troca?fNum(d.troca):"—"}</td><td class="n">${d.emp?fNum(d.emp):"—"}</td><td class="n">${d.entrada?fNum(d.entrada):"—"}</td>
    <td class="n">${d.gasto?fBRL(d.gasto):"—"}</td><td class="n">${d.estoque===undefined?'<span class="muted">excluído</span>':fNum(d.estoque)+" "+esc(d.unidade||"")}</td></tr>`).join("")
    : `<tr><td colspan="8"><div class="empty">Nenhuma movimentação no período escolhido.</div></td></tr>`;
}

// colunas agrupadas: retiradas x entradas por dia (períodos curtos) ou por mês
function graficoMeses(ret, ent, de, ate){
  const box = $("#d-meses"), dias = Math.round((new Date(ate) - new Date(de)) / 864e5) + 1;
  const porDia = dias <= 35, buckets = [];
  if (porDia) { for (let d = new Date(de+"T12:00:00"); iso(d) <= ate; d.setDate(d.getDate()+1)) buckets.push({k:iso(d), r:`${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`}); }
  else { let d = new Date(de.slice(0,7)+"-01T12:00:00"); while (iso(d).slice(0,7) <= ate.slice(0,7)) { buckets.push({k:iso(d).slice(0,7), r:MESES[d.getMonth()].slice(0,3)+"/"+String(d.getFullYear()).slice(2)}); d.setMonth(d.getMonth()+1); } }
  const chave = m => porDia ? String(m.data).slice(0,10) : String(m.data).slice(0,7);
  buckets.forEach(b => { b.a = ret.filter(m => chave(m)===b.k).length; b.b = ent.filter(m => chave(m)===b.k).length; });
  $("#d-meses-tit").textContent = porDia ? "Retiradas e entradas por dia" : "Retiradas e entradas por mês";
  if (!buckets.some(b => b.a || b.b)) { box.innerHTML = `<div class="empty">Nenhuma retirada ou entrada no período.</div>`; return; }
  const W = Math.max(300, box.clientWidth || 640), H = 230, padL = 34, padR = 8, padT = 12, padB = 26;
  const max = niceMax(Math.max(...buckets.map(b => Math.max(b.a, b.b))));
  const iw = W - padL - padR, ih = H - padT - padB, bw = iw / buckets.length;
  const barW = Math.max(2, Math.min(24, (bw - 6) / 2));
  const y = v => padT + ih - (v/max)*ih;
  const ticks = [0, max/4, max/2, max*3/4, max].filter(t => Number.isInteger(t));
  const passo = Math.ceil(buckets.length / Math.floor(iw / 44));
  const col = (x, v, cor) => { if (!v) return ""; const h = (v/max)*ih, r = Math.min(4, h, barW/2); const yt = padT+ih-h;
    return `<path d="M${x},${padT+ih} V${yt+r} Q${x},${yt} ${x+r},${yt} H${x+barW-r} Q${x+barW},${yt} ${x+barW},${yt+r} V${padT+ih} Z" fill="var(${cor})"/>`; };
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc($("#d-meses-tit").textContent)}">`;
  ticks.forEach(t => { svg += `<line x1="${padL}" x2="${W-padR}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${padL-6}" y="${y(t)+4}" text-anchor="end" class="ax">${t}</text>`; });
  buckets.forEach((b, i) => {
    const cx = padL + i*bw + bw/2;
    svg += col(cx - barW - 1, b.a, "--s1") + col(cx + 1, b.b, "--s2");
    if (i % passo === 0) svg += `<text x="${cx}" y="${H-8}" text-anchor="middle" class="ax">${esc(b.r)}</text>`;
    svg += `<rect x="${padL+i*bw}" y="${padT}" width="${bw}" height="${ih}" fill="transparent" tabindex="0" data-tip="${tipAttr(porDia ? fData(b.k) : b.r, [["retiradas", String(b.a), "--s1"], ["entradas", String(b.b), "--s2"]])}"/>`;
  });
  svg += `<line x1="${padL}" x2="${W-padR}" y1="${padT+ih}" y2="${padT+ih}" class="base"/></svg>`;
  box.innerHTML = svg;
}
let resizeT; window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (S.tab==="dashboard" && S.rel) renderDash(); }, 200); });

$("#d-mais").addEventListener("click", () => { S.detTodos = !S.detTodos; renderDash(); });
$("#d-csv").addEventListener("click", () => {
  const R = S.rel; if (!R || !S.detalhe) return;
  const cell = v => { const s = String(v ?? ""); return /[";\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const n = v => v ? String(v).replace(".",",") : "0";
  const linhas = [["Código","Item","Categoria","Saídas","Trocas","Empréstimos","Entradas","Compras (R$)","Estoque atual","Unidade","Último movimento"].join(";")]
    .concat(S.detalhe.map(d => [d.codigo, d.nome, d.cat, n(d.saida), n(d.troca), n(d.emp), n(d.entrada), n(Math.round(d.gasto*100)/100), d.estoque===undefined?"":n(d.estoque), d.unidade, d.ultimo?fData(d.ultimo):""].map(cell).join(";")));
  const blob = new Blob(["﻿"+linhas.join("\r\n")], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `consumo-por-item-${R.de}-a-${R.ate}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});

// ---------- usuários e permissões ----------
async function carregarEquipe(){
  if (!can("usuarios")) return;
  try { const r = await api("usuarios"); S.eq = r.equipe; renderEquipe(); }
  catch(e){ toast(e.message, true); }
}
function renderEquipe(){
  const E = S.eq;
  if (!E) { $("#q-usuarios").innerHTML = `<tr><td colspan="6"><div class="empty">Carregando…</div></td></tr>`; return; }
  const us = [...E.usuarios].sort((a,b) => (b.ativo - a.ativo) || String(a.nome).localeCompare(String(b.nome),"pt-BR"));
  $("#q-usuarios").innerHTML = us.map(u => `<tr class="${u.ativo?"":"inativo"}">
    <td><b>${esc(u.nome||"—")}</b>${u.usuario===S.usuario?' <span class="muted">(você)</span>':""}</td>
    <td class="mono">${esc(u.usuario)}</td>
    <td>${esc(u.perfil)}</td>
    <td>${u.ativo ? '<span class="pill s-ok">Ativo</span>' : '<span class="pill p-ajuste">Bloqueado</span>'}</td>
    <td class="hide-s"><span class="mono senha" data-s="${esc(u.senha)}">••••••</span> <button class="link small-link" data-ver type="button">ver</button></td>
    <td class="n"><button class="btn small" data-u="${esc(u.usuario)}">Editar</button></td></tr>`).join("");
  // matriz de permissões
  const grupos = [...new Set(E.permissoes.map(p => p.grupo))];
  $("#q-matriz").innerHTML = `<thead><tr><th>Permissão</th>${E.perfis.map(p => `<th class="c">${esc(p.nome)}<div>${p.fixo ? '<span class="muted">acesso total</span>' : `<button class="link small-link" data-perfil="${esc(p.nome)}" type="button">editar</button>`}</div></th>`).join("")}</tr></thead><tbody>`
    + grupos.map(g => `<tr class="grp"><td colspan="${E.perfis.length+1}">${esc(g)}</td></tr>` + E.permissoes.filter(p => p.grupo===g).map(p => `<tr><td>${esc(p.descricao)}</td>${E.perfis.map(f => `<td class="c">${f.perms[p.chave] ? '<span class="sim" aria-label="sim">✓</span>' : '<span class="nao" aria-label="não">—</span>'}</td>`).join("")}</tr>`).join("")).join("") + `</tbody>`;
}
$("#q-usuarios").addEventListener("click", e => {
  const v = e.target.closest("[data-ver]");
  if (v) { const s = v.parentElement.querySelector(".senha"); const aberto = v.textContent === "ocultar"; s.textContent = aberto ? "••••••" : s.dataset.s; v.textContent = aberto ? "ver" : "ocultar"; return; }
  const b = e.target.closest("[data-u]"); if (b) abrirUsuario(b.dataset.u);
});
$("#q-novo-u").addEventListener("click", () => abrirUsuario(null));
$("#q-matriz").addEventListener("click", e => { const b = e.target.closest("[data-perfil]"); if (b) abrirPerfil(b.dataset.perfil); });
$("#q-novo-p").addEventListener("click", () => abrirPerfil(null));

const gerarSenha = () => String(Math.floor(100000 + Math.random()*900000));
function abrirUsuario(usuario){
  const E = S.eq; if (!E) return;
  const u = usuario ? E.usuarios.find(x => x.usuario===usuario) : null;
  const v = u || {usuario:"", nome:"", senha:gerarSenha(), perfil:(E.perfis.find(p => !p.fixo)||E.perfis[0]).nome, ativo:true};
  const eu = u && u.usuario === S.usuario;
  $("#modal-box").innerHTML = `
    <h3>${u ? "Editar colaborador" : "Novo colaborador"}</h3>
    <form class="form" id="f-u" novalidate autocomplete="off">
      <div class="field full"><label for="u-nome">Nome do colaborador <span class="req">*</span></label><input class="input" id="u-nome" value="${esc(v.nome)}" placeholder="Ex.: João da Silva"></div>
      <div class="field"><label for="u-usuario">Usuário (para entrar) <span class="req">*</span></label><input class="input mono" id="u-usuario" value="${esc(v.usuario)}" autocapitalize="none" spellcheck="false" placeholder="Ex.: joao"></div>
      <div class="field"><label for="u-senha">Senha <span class="req">*</span></label><div class="actions" style="flex-wrap:nowrap"><input class="input mono" id="u-senha" value="${esc(v.senha)}"><button class="btn small" type="button" id="u-gerar">Gerar</button></div></div>
      <div class="field"><label for="u-perfil">Perfil</label><select class="input" id="u-perfil">${E.perfis.map(p => `<option ${p.nome===v.perfil?"selected":""}>${esc(p.nome)}</option>`).join("")}</select></div>
      <div class="field"><label for="u-ativo">Situação</label><select class="input" id="u-ativo" ${eu?"disabled":""}><option value="1" ${v.ativo?"selected":""}>Ativo: pode entrar</option><option value="0" ${v.ativo?"":"selected"}>Bloqueado: não entra mais</option></select></div>
      <p class="hint full">Passe o usuário e a senha para o colaborador. O nome aparece no histórico em cada lançamento que ele fizer.</p>
      <div class="full actions"><button class="btn primary" type="submit" id="u-ok">${u ? "Salvar" : "Criar login"}</button><button class="btn" type="button" id="u-no">Cancelar</button><span class="hint" id="u-msg"></span></div>
    </form>`;
  $("#modal").hidden = false; $("#u-nome").focus();
  $("#u-no").onclick = fecharModal;
  $("#u-gerar").onclick = () => { $("#u-senha").value = gerarSenha(); };
  $("#u-nome").addEventListener("input", () => {
    if (u || $("#u-usuario").dataset.mexeu) return;
    $("#u-usuario").value = norm($("#u-nome").value.trim().split(/\s+/)[0] || "").replace(/[^a-z0-9]/g, "");
  });
  $("#u-usuario").addEventListener("input", () => { $("#u-usuario").dataset.mexeu = "1"; });
  $("#f-u").addEventListener("submit", async ev => {
    ev.preventDefault();
    const msg = $("#u-msg"); msg.className = "hint err";
    const nu = {nome:$("#u-nome").value.trim(), usuario:$("#u-usuario").value.trim().toLowerCase(), senha:$("#u-senha").value.trim(), perfil:$("#u-perfil").value, ativo:$("#u-ativo").value==="1"};
    if (!nu.nome) { msg.textContent = "Informe o nome do colaborador."; return; }
    if (!/^[a-z0-9._@-]{2,40}$/.test(nu.usuario)) { msg.textContent = "Usuário: só letras minúsculas, números, ponto ou traço, sem espaços."; return; }
    if (nu.senha.length < 4) { msg.textContent = "A senha precisa ter pelo menos 4 caracteres."; return; }
    await enviar($("#u-ok"), msg, "salvarUsuario", {original: u ? u.usuario : "", u: nu}, r => {
      S.eq = r.equipe; fecharModal(); renderEquipe();
      if (eu) { S.usuario = nu.usuario; S.senha = nu.senha; guardar(); api("entrar").then(renderMe).catch(()=>{}); }
    });
  });
}
function abrirPerfil(nome){
  const E = S.eq; if (!E) return;
  const p = nome ? E.perfis.find(x => x.nome===nome) : null;
  const perms = p ? p.perms : {painel:true, itens_ver:true};
  const grupos = [...new Set(E.permissoes.map(x => x.grupo))];
  const emUso = p ? E.usuarios.filter(u => u.perfil===p.nome).length : 0;
  $("#modal-box").innerHTML = `
    <h3>${p ? "Editar perfil" : "Novo perfil"}</h3>
    <form id="f-p" novalidate autocomplete="off" class="stack" style="gap:14px">
      <div class="field"><label for="p-nome">Nome do perfil <span class="req">*</span></label><input class="input" id="p-nome" value="${esc(p ? p.nome : "")}" placeholder="Ex.: Portaria, Jardinagem, Supervisão"></div>
      <div class="perm-grupos">${grupos.map(g => `<fieldset class="perm-g"><legend>${esc(g)}</legend>${E.permissoes.filter(x => x.grupo===g).map(x => `<label class="perm"><input type="checkbox" data-k="${esc(x.chave)}" ${perms[x.chave]?"checked":""}> ${esc(x.descricao)}</label>`).join("")}</fieldset>`).join("")}</div>
      ${p ? `<p class="hint">${emUso} colaborador${emUso===1?"":"es"} com este perfil. A mudança vale a partir do próximo acesso de cada um.</p>` : ""}
      <div class="actions"><button class="btn primary" type="submit" id="p-ok">${p ? "Salvar permissões" : "Criar perfil"}</button><button class="btn" type="button" id="p-no">Cancelar</button>
        ${p ? `<button class="btn danger" type="button" id="p-del" style="margin-left:auto">Excluir perfil</button>` : ""}<span class="hint" id="p-msg"></span></div>
      <div class="confirm" id="p-conf" hidden><span>Excluir o perfil <b>${esc(p ? p.nome : "")}</b>?</span><div class="actions"><button class="btn danger" type="button" id="p-del-ok">Sim, excluir</button><button class="btn" type="button" id="p-del-no">Manter</button></div></div>
    </form>`;
  $("#modal").hidden = false; $("#p-nome").focus();
  $("#p-no").onclick = fecharModal;
  const depois = r => { S.eq = r.equipe; fecharModal(); renderEquipe(); if (p && p.nome === S.perfil) api("entrar").then(() => { renderMe(); setTab(S.tab); }).catch(()=>{}); };
  if (p) {
    $("#p-del").onclick = () => { $("#p-conf").hidden = false; };
    $("#p-del-no").onclick = () => { $("#p-conf").hidden = true; };
    $("#p-del-ok").onclick = () => enviar($("#p-del-ok"), $("#p-msg"), "excluirPerfil", {nome:p.nome}, depois);
  }
  $("#f-p").addEventListener("submit", async ev => {
    ev.preventDefault();
    const msg = $("#p-msg"); msg.className = "hint err";
    const nn = $("#p-nome").value.trim();
    if (!nn) { msg.textContent = "Informe o nome do perfil."; return; }
    const sel = {}; $$("#f-p [data-k]").forEach(c => { sel[c.dataset.k] = c.checked; });
    await enviar($("#p-ok"), msg, "salvarPerfil", {original: p ? p.nome : "", nome:nn, perms:sel}, depois);
  });
}

// ---------- início ----------
$("#m-data").value = hoje();
setTipo("saida");
renderNotices();
const ini = (location.hash||"").slice(1);
if (Object.keys(ABAS_PERM).includes(ini)) S.tab = ini;
renderAll();
const sess = lerSessao();
if (sess && sess.senha && sess.usuario) {
  S.usuario = sess.usuario || ""; S.senha = sess.senha;
  api("entrar").then(() => { renderMe(); setTab(podeAba(S.tab) ? S.tab : primeiraAba()); atualizar(); }).catch(e => { S.senha = ""; mostrarLogin(e.message); });
} else {
  mostrarLogin("");
}
})();
