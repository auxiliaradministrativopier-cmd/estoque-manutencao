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
  tab:"painel", tipo:"saida", picked:null, iStatus:"", hTipo:"", histMes:mesDe(), ocupado:false, ultima:null,
  os:[], colab:[], oFiltro:"aberto", fotos:new Map()
};
const can = p => !!(S.perms && S.perms[p]);
const ABAS_PERM = {painel:["painel"], os:["os_ver","os_abrir","os_atender","os_gerenciar"], registrar:["registrar_saida","registrar_entrada","registrar_troca","registrar_emprestimo"], itens:["itens_ver"], historico:["historico_ver"], emprestimos:["devolver","registrar_emprestimo"], dashboard:["dashboard"], usuarios:["usuarios"]};
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
  S.os = d.os || [];
  S.colab = d.colaboradores || [];
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
function toast(msg, err){ const t = $("#toast"); t.textContent = msg; t.className = "toast"+(err?" err":""); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(()=>t.hidden=true, Math.max(err?5500:3000, String(msg).length*55)); }
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
  const abertas = osAbertas(), osAtras = abertas.filter(osAtrasada);
  $("#k-os").textContent = abertas.length;
  $("#k-os-sub").textContent = osAtras.length ? `${osAtras.length} atrasada${osAtras.length===1?"":"s"}` : `${abertas.filter(o=>o.status==="Em andamento").length} em andamento`;
  $("#k-os-box").classList.toggle("crit", osAtras.length>0);
  const bo = $("#b-os"); bo.textContent = abertas.length; bo.classList.toggle("alert", osAtras.length>0);
  const lista = [...abertas].sort(ordemOS).slice(0,6);
  $("#p-os").innerHTML = lista.length ? lista.map(o => `
    <button class="row row-btn" data-os="${esc(o.id)}" type="button"><div>${prioPill(o.prioridade)}</div>
      <div><div class="t"><span class="mono muted">${esc(o.numero)}</span> ${esc(o.titulo)}</div><div class="d">${esc([o.local, o.responsavel||"sem responsável"].filter(Boolean).join(" · "))}</div></div>
      <div class="r">${statusPill(o)}<div class="d">${osAtrasada(o) ? `<span class="atras">venceu ${fData(o.prazo)}</span>` : "prazo "+fData(o.prazo)}</div></div></button>`).join("")
    + (abertas.length>6 ? `<div class="empty"><button class="link" data-go2="os">Ver todas as ${abertas.length}</button></div>`:"")
    : `<div class="empty">Nenhuma OS em aberto.${can("os_abrir") ? ` <button class="link" type="button" id="p-os-nova">Abrir uma OS</button>` : ""}</div>`;
  const be = $("#b-emp"); be.textContent = S.emprestimos.length; be.classList.toggle("alert", atras>0);

  const ult = doMes.filter(m => m.obs !== "Importação de inventário").sort(ordMov).slice(0,10);
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
  else { if (m.os) p.push(m.os); if (m.responsavel) p.push(m.responsavel); if (m.destino) p.push("→ "+m.destino); if (m.tipo==="troca" && m.velhoDestino) p.push("peça velha: "+String(m.velhoDestino).toLowerCase()); }
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
function fecharModal(){ $("#modal").hidden = true; $("#modal-box").innerHTML = ""; $("#modal-box").onclick = null; $("#modal-box").classList.remove("largo"); }
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
  if (!podeAba("os")) $("#m-osref-box").hidden = true;
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
  if ((t==="saida" || t==="troca") && $("#m-osref").value) mov.os = $("#m-osref").value;
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
      <span class="sub">${esc([m.os, m.motivo, m.tipo==="troca"&&m.velhoDestino?"Peça velha: "+m.velhoDestino:"", m.tipo==="emprestimo"&&m.previsao?"Devolver até "+fData(m.previsao):"", m.estadoDevolucao||"", m.obs].filter(Boolean).join(" · "))}</span></td>
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
  if (S.tab==="os") renderOS();
  renderOsRef();
  renderPicked();
}

// ---------- permissões na tela ----------
function aplicarPermissoes(){
  $$("nav.tabs button").forEach(b => b.hidden = !podeAba(b.dataset.tab));
  const tipos = {saida:"registrar_saida", entrada:"registrar_entrada", troca:"registrar_troca", emprestimo:"registrar_emprestimo"};
  $$("#seg button").forEach(b => b.hidden = !can(tipos[b.dataset.tipo]));
  if (!can(tipos[S.tipo])) { const t = Object.keys(tipos).find(k => can(tipos[k])); if (t) setTipo(t); }
  $("#i-novo").hidden = !can("itens_cadastrar");
  $("#i-importar").hidden = !can("itens_editar");
  $("#o-nova").hidden = !can("os_abrir");
  $("#k-os-box").hidden = $("#p-os-box").hidden = !podeAba("os");
  $("#m-osref-box").hidden = !podeAba("os") || !["saida","troca"].includes(S.tipo);
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
  renderDashOS(R);

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

// ---------- ordens de serviço ----------
const OS_CATEGORIAS = ["Elétrica","Hidráulica","Iluminação","Pintura","Alvenaria e acabamento","Serralheria","Marcenaria","Piscina","Jardinagem","Portões e acessos","Equipamentos","Limpeza","Outros"];
const OS_PRAZO = {Urgente:0, Alta:2, Normal:7, Baixa:15};
const osEncerrada = o => o.status==="Concluída" || o.status==="Cancelada";
const osAbertas = () => S.os.filter(o => !osEncerrada(o));
const osAtrasada = o => !osEncerrada(o) && o.prazo && o.prazo < hoje();
const PRIO_ORD = {Urgente:0, Alta:1, Normal:2, Baixa:3};
const ordemOS = (a,b) => (osAtrasada(b) - osAtrasada(a)) || ((PRIO_ORD[a.prioridade]??2) - (PRIO_ORD[b.prioridade]??2)) || String(a.prazo).localeCompare(String(b.prazo)) || String(a.numero).localeCompare(String(b.numero));
const prioPill = p => `<span class="pill prio-${esc(norm(p||"Normal"))}">${esc(p||"Normal")}</span>`;
function statusPill(o){
  if (osAtrasada(o)) return `<span class="pill s-zero">${esc(o.status)} · atrasada</span>`;
  const cls = {"Aberta":"st-aberta","Em andamento":"st-andamento","Concluída":"s-ok","Cancelada":"p-ajuste"}[o.status] || "p-ajuste";
  return `<span class="pill ${cls}">${esc(o.status)}</span>`;
}
const dt = s => s ? new Date(String(s).replace(" ","T")) : null;
const fDataHora = s => s ? fData(s) + (String(s).length > 10 ? " " + String(s).slice(11,16) : "") : "—";
function osDireitos(o){
  const ger = can("os_gerenciar"), livre = !o.responsavelUsuario, minha = o.responsavelUsuario === S.usuario;
  return {ger, livre, minha, enc: osEncerrada(o), atender: ger || (can("os_atender") && (minha || livre)), abriu: o.abertaPorUsuario === S.usuario};
}
function prazoPara(prio){ const d = new Date(); d.setDate(d.getDate() + (OS_PRAZO[prio] ?? 7)); return iso(d); }
document.addEventListener("click", e => {
  const b = e.target.closest("[data-os]"); if (b) { abrirOS(b.dataset.os); return; }
  if (e.target.id === "p-os-nova") novaOS();
});

function renderOS(){
  const q = norm($("#o-busca").value), cat = $("#o-cat").value, f = S.oFiltro;
  const cats = [...new Set(S.os.map(o => o.categoria).filter(Boolean))].sort((x,y)=>x.localeCompare(y,"pt-BR"));
  const sel = $("#o-cat"), cur = sel.value;
  sel.innerHTML = `<option value="">Todas as categorias</option>` + cats.map(c => `<option ${c===cur?"selected":""}>${esc(c)}</option>`).join("");
  $("#dl-local").innerHTML = [...new Set(S.os.map(o=>o.local).concat(S.movs.map(m=>m.destino)).filter(Boolean).map(s=>String(s).trim()))].sort().slice(0,300).map(v=>`<option value="${esc(v)}">`).join("");
  $$("#o-filtros .chip").forEach(c => { if (c.dataset.f==="minhas") c.hidden = !can("os_atender") && !can("os_gerenciar"); });
  const list = S.os.filter(o => {
    if (f==="aberto" && osEncerrada(o)) return false;
    if (f==="minhas" && (osEncerrada(o) || o.responsavelUsuario !== S.usuario)) return false;
    if (f==="atrasadas" && !osAtrasada(o)) return false;
    if (f==="concluidas" && o.status!=="Concluída") return false;
    if (f==="canceladas" && o.status!=="Cancelada") return false;
    if (cat && o.categoria!==cat) return false;
    if (q && !norm([o.numero,o.titulo,o.local,o.categoria,o.responsavel,o.solicitante,o.abertaPor,o.descricao].join(" ")).includes(q)) return false;
    return true;
  }).sort((x,y) => osEncerrada(x)||osEncerrada(y) ? String(y.concluidaEm||y.abertaEm).localeCompare(String(x.concluidaEm||x.abertaEm)) : ordemOS(x,y));
  const vazio = {aberto:"Nenhuma OS em aberto.", minhas:"Nenhuma OS em aberto com você.", atrasadas:"Nenhuma OS atrasada.", concluidas:"Nenhuma OS concluída nos últimos 90 dias.", canceladas:"Nenhuma OS cancelada nos últimos 90 dias.", todas:"Nenhuma OS registrada ainda."}[f];
  $("#o-body").innerHTML = list.length ? list.map(o => `<tr class="click" data-os="${esc(o.id)}" tabindex="0">
    <td class="mono" style="white-space:nowrap">${esc(o.numero)}</td>
    <td><b>${esc(o.titulo)}</b><span class="sub">${esc([o.categoria, o.solicitante ? "pedido por "+o.solicitante : ""].filter(Boolean).join(" · "))}</span></td>
    <td class="hide-s">${esc(o.local)}</td>
    <td>${prioPill(o.prioridade)}</td>
    <td>${statusPill(o)}</td>
    <td class="hide-s num" style="white-space:nowrap">${osEncerrada(o) ? '<span class="muted">'+fData(o.concluidaEm)+'</span>' : fData(o.prazo)}</td>
    <td class="hide-m">${esc(o.responsavel || "—")}</td></tr>`).join("")
    : `<tr><td colspan="7"><div class="empty">${q||cat ? "Nenhuma OS com esses filtros." : vazio}${f==="aberto" && can("os_abrir") ? ` <button class="link" type="button" id="p-os-nova">Abrir uma OS</button>` : ""}</div></td></tr>`;
}
$("#o-busca").addEventListener("input", renderOS);
$("#o-cat").addEventListener("change", renderOS);
$$("#o-filtros .chip").forEach(c => c.addEventListener("click", () => { S.oFiltro = c.dataset.f; syncChips("#o-filtros","f",S.oFiltro); renderOS(); }));
$("#o-nova").addEventListener("click", () => novaOS());
$("#o-body").addEventListener("keydown", e => { if (e.key==="Enter" && e.target.dataset.os) abrirOS(e.target.dataset.os); });

function camposOS(v, comResp){
  const cats = OS_CATEGORIAS.includes(v.categoria) || !v.categoria ? OS_CATEGORIAS : [v.categoria, ...OS_CATEGORIAS];
  return `
      <div class="field full"><label for="os-titulo">Serviço <span class="req">*</span></label><input class="input" id="os-titulo" value="${esc(v.titulo||"")}" placeholder="Ex.: Lâmpada queimada no hall do 3º andar" maxlength="120"></div>
      <div class="field"><label for="os-local">Local <span class="req">*</span></label><input class="input" id="os-local" value="${esc(v.local||"")}" list="dl-local" placeholder="Ex.: Bloco B, Piscina, Portaria"></div>
      <div class="field"><label for="os-cat">Categoria</label><select class="input" id="os-cat"><option value="">Selecione</option>${cats.map(c=>`<option ${c===v.categoria?"selected":""}>${esc(c)}</option>`).join("")}</select></div>
      <div class="field"><label for="os-prio">Prioridade</label><select class="input" id="os-prio">${["Urgente","Alta","Normal","Baixa"].map(p=>`<option ${p===(v.prioridade||"Normal")?"selected":""}>${p}</option>`).join("")}</select></div>
      <div class="field"><label for="os-prazo">Prazo</label><input class="input" type="date" id="os-prazo" value="${esc(v.prazo || prazoPara(v.prioridade||"Normal"))}"></div>
      <div class="field full"><label for="os-desc">Descrição</label><textarea class="input" id="os-desc" placeholder="O que está acontecendo, desde quando, detalhes que ajudam no atendimento" maxlength="3000">${esc(v.descricao||"")}</textarea></div>
      <div class="field"><label for="os-solic">Quem pediu</label><input class="input" id="os-solic" value="${esc(v.solicitante||"")}" placeholder="Ex.: Portaria, Síndico, Apto 302"></div>
      ${comResp ? `<div class="field"><label for="os-resp">Responsável</label><select class="input" id="os-resp"><option value="">Sem responsável por enquanto</option>${S.colab.map(c=>`<option value="${esc(c.usuario)}">${esc(c.nome)}</option>`).join("")}</select></div>` : ""}`;
}
function lerCamposOS(msg){
  const v = {titulo:$("#os-titulo").value.trim(), local:$("#os-local").value.trim(), categoria:$("#os-cat").value, prioridade:$("#os-prio").value, prazo:$("#os-prazo").value, descricao:$("#os-desc").value.trim(), solicitante:$("#os-solic").value.trim()};
  if (!v.titulo) { msg.className="hint err"; msg.textContent = "Descreva o serviço em poucas palavras."; return null; }
  if (!v.local) { msg.className="hint err"; msg.textContent = "Informe o local."; return null; }
  return v;
}
function ligarPrazo(){
  let mexeu = false;
  $("#os-prazo").addEventListener("input", () => { mexeu = true; });
  $("#os-prio").addEventListener("change", () => { if (!mexeu) $("#os-prazo").value = prazoPara($("#os-prio").value); });
}

function novaOS(){
  if (!can("os_abrir")) return;
  $("#modal-box").innerHTML = `
    <h3>Abrir ordem de serviço</h3>
    <form class="form" id="f-os" novalidate autocomplete="off">
      ${camposOS({}, can("os_gerenciar"))}
      <div class="field full"><label for="os-fotos">Fotos do problema (antes)</label><input class="input" type="file" id="os-fotos" accept="image/*" multiple><span class="hint">Até 8 fotos. Elas são reduzidas antes do envio.</span></div>
      <div class="full actions"><button class="btn primary" type="submit" id="os-ok">Abrir OS</button><button class="btn" type="button" id="os-no">Cancelar</button><span class="hint" id="os-msg"></span></div>
    </form>`;
  $("#modal").hidden = false; $("#os-titulo").focus();
  $("#os-no").onclick = fecharModal;
  ligarPrazo();
  $("#f-os").addEventListener("submit", async ev => {
    ev.preventDefault();
    const msg = $("#os-msg"), v = lerCamposOS(msg); if (!v) return;
    if ($("#os-resp") && $("#os-resp").value) v.responsavelUsuario = $("#os-resp").value;
    const arquivos = [...$("#os-fotos").files].slice(0, 8);
    const r = await enviar($("#os-ok"), msg, "osAbrir", {os:v});
    if (!r) return;
    if (arquivos.length) { $("#os-ok").disabled = true; await enviarFotos(r.osId, "antes", arquivos, msg); }
    fecharModal(); setTab("os"); abrirOS(r.osId);
  });
}

async function reduzirFoto(file){
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => erro(new Error("img")); i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth*k); c.height = Math.round(img.naturalHeight*k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82).split(",")[1];
  } finally { URL.revokeObjectURL(url); }
}
async function enviarFotos(osId, fase, arquivos, msgEl){
  let ok = 0;
  for (let i = 0; i < arquivos.length; i++) {
    if (msgEl) { msgEl.className = "hint"; msgEl.innerHTML = `<span class="spin" aria-hidden="true"></span> Enviando foto ${i+1} de ${arquivos.length}…`; }
    try { const b64 = await reduzirFoto(arquivos[i]); await api("osFoto", {id:osId, fase, mime:"image/jpeg", b64}); ok++; }
    catch(e){ toast(e && e.message && e.message !== "img" ? e.message : `Não deu para ler a foto ${arquivos[i].name}.`, true); }
  }
  if (ok) toast(ok === 1 ? "Foto anexada." : `${ok} fotos anexadas.`);
  return ok;
}
async function carregarFoto(id){
  if (S.fotos.has(id)) return S.fotos.get(id);
  const p = api("osFotoVer", {fotoId:id}).then(r => `data:${r.foto.mime};base64,${r.foto.b64}`);
  S.fotos.set(id, p);
  p.catch(() => S.fotos.delete(id));
  return p;
}
function galeria(o, fase, d){
  const ids = String((fase==="antes" ? o.fotosAntes : o.fotosDepois) || "").split(",").filter(Boolean);
  const pode = fase==="antes" ? (d.atender || (d.abriu && can("os_abrir"))) && o.status!=="Cancelada" : d.atender && o.status!=="Cancelada";
  const remover = d.ger || (d.atender && !d.enc);
  return `<div class="fotos">${ids.map(id => `<div class="foto"><button type="button" class="foto-ver" data-foto="${esc(id)}" aria-label="Ampliar foto"><span class="spin" aria-hidden="true"></span></button>${remover?`<button type="button" class="foto-x" data-fx="${esc(id)}" data-fase="${fase}" aria-label="Tirar foto">×</button>`:""}</div>`).join("")}
    ${pode && ids.length < 8 ? `<label class="foto-add"><input type="file" accept="image/*" multiple data-up="${fase}" hidden><span>+ Foto</span></label>` : ""}
    ${!ids.length && !pode ? '<span class="muted">Sem fotos.</span>' : ""}</div>`;
}

function abrirOS(id){
  const o = S.os.find(x => x.id === id); if (!o) { toast("Esta OS não está mais na lista. Atualize a página.", true); return; }
  const d = osDireitos(o);
  const mats = o.materiais || [];
  const linhasAnd = String(o.andamento||"").split("\n").filter(Boolean).reverse();
  const dur = o.concluidaEm && o.abertaEm ? duracao(dt(o.abertaEm), dt(o.concluidaEm)) : "";
  const acoes = [];
  if (o.status==="Aberta" && d.atender) acoes.push(`<button class="btn primary" type="button" data-op="iniciar">Iniciar atendimento</button>`);
  if (!d.enc && d.atender) acoes.push(`<button class="btn ${o.status==="Em andamento"?"primary":""}" type="button" data-op="concluir">Concluir</button>`);
  if (!d.enc && (can("registrar_saida") || can("registrar_troca"))) acoes.push(`<button class="btn" type="button" data-op="material">Retirar material</button>`);
  if (!d.enc && d.ger) acoes.push(`<button class="btn" type="button" data-op="atribuir">${o.responsavelUsuario?"Trocar responsável":"Atribuir"}</button>`);
  if (d.ger || (d.abriu && o.status==="Aberta")) acoes.push(`<button class="btn" type="button" data-op="editar">Editar</button>`);
  if (can("os_abrir") || can("os_atender") || d.ger) acoes.push(`<button class="btn" type="button" data-op="nota">Anotar</button>`);
  if (!d.enc && d.ger) acoes.push(`<button class="btn danger" type="button" data-op="cancelar">Cancelar OS</button>`);
  if (d.enc && d.ger) acoes.push(`<button class="btn" type="button" data-op="reabrir">Reabrir</button>`);
  $("#modal-box").innerHTML = `
    <div class="os-top"><span class="mono muted">${esc(o.numero)}</span>${statusPill(o)}${prioPill(o.prioridade)}</div>
    <h3 class="os-tit">${esc(o.titulo)}</h3>
    <dl class="os-info">
      <div><dt>Local</dt><dd>${esc(o.local||"—")}</dd></div>
      <div><dt>Categoria</dt><dd>${esc(o.categoria||"—")}</dd></div>
      <div><dt>Responsável</dt><dd>${esc(o.responsavel||"Sem responsável")}</dd></div>
      <div><dt>Prazo</dt><dd class="${osAtrasada(o)?"atras":""}">${fData(o.prazo)}${osAtrasada(o)?" · atrasada":""}</dd></div>
      <div><dt>Aberta</dt><dd>${fDataHora(o.abertaEm)} por ${esc(o.abertaPor||"—")}</dd></div>
      <div><dt>Quem pediu</dt><dd>${esc(o.solicitante||"—")}</dd></div>
      ${o.concluidaEm ? `<div><dt>${o.status==="Cancelada"?"Cancelada":"Concluída"}</dt><dd>${fDataHora(o.concluidaEm)}${o.concluidaPor?" por "+esc(o.concluidaPor):""}${dur&&o.status==="Concluída"?" · "+dur:""}</dd></div>` : ""}
    </dl>
    ${o.descricao ? `<p class="os-desc">${esc(o.descricao)}</p>` : ""}
    ${o.solucao ? `<div class="os-sol"><b>O que foi feito</b><p>${esc(o.solucao)}</p></div>` : ""}
    ${o.motivoCancelamento ? `<div class="os-sol canc"><b>Motivo do cancelamento</b><p>${esc(o.motivoCancelamento)}</p></div>` : ""}
    <div class="os-acoes actions">${acoes.join("")}</div>
    <div id="os-form"></div>
    <div class="os-grid">
      <section><h4>Fotos antes</h4>${galeria(o,"antes",d)}</section>
      <section><h4>Fotos depois</h4>${galeria(o,"depois",d)}</section>
    </div>
    <section><h4>Materiais retirados <span class="muted">(${mats.filter(m=>!m.estornado).length})</span></h4>
      ${mats.length ? `<div class="rows">${mats.map(m => `<div class="row"><div>${pill(m.tipo)}</div><div><div class="t ${m.estornado?"struck":""}">${esc(m.itemNome)}</div><div class="d">${fData(m.data)} · ${esc(m.registradoPor||"")}${m.estornado?" · estornado":""}</div></div><div class="r num">${fNum(m.qtd)} ${esc(m.unidade||"")}</div></div>`).join("")}</div>` : '<p class="muted">Nenhum material retirado por esta OS.</p>'}
    </section>
    <section><h4>Andamento</h4><ol class="timeline">${linhasAnd.map(l => { const [q, ...resto] = l.split(" · "); return `<li><span class="when">${esc(q)}</span> ${esc(resto.join(" · "))}</li>`; }).join("")}</ol></section>
    <div class="actions" style="margin-top:6px"><button class="btn" type="button" id="os-fechar">Fechar</button><span class="hint" id="os-msg"></span></div>`;
  $("#modal-box").classList.add("largo");
  $("#modal").hidden = false;
  $("#os-fechar").onclick = fecharModal;
  $$("#modal-box .foto-ver").forEach(async b => {
    try { const src = await carregarFoto(b.dataset.foto); b.innerHTML = `<img src="${src}" alt="Foto da ${esc(o.numero)}">`; }
    catch(e){ b.innerHTML = '<span class="muted">sem acesso</span>'; }
  });
  $("#modal-box").onclick = async e => {
    const v = e.target.closest(".foto-ver");
    if (v && v.querySelector("img")) { verFotoGrande(v.querySelector("img").src); return; }
    const x = e.target.closest("[data-fx]");
    if (x) { const r = await enviar(null, $("#os-msg"), "osFotoRemover", {id:o.id, fase:x.dataset.fase, fotoId:x.dataset.fx}); if (r) abrirOS(o.id); return; }
    const b = e.target.closest("[data-op]"); if (b) acaoOS(o, b.dataset.op);
  };
  $$("#modal-box [data-up]").forEach(inp => inp.addEventListener("change", async () => {
    const arquivos = [...inp.files]; if (!arquivos.length) return;
    await enviarFotos(o.id, inp.dataset.up, arquivos, $("#os-msg"));
    abrirOS(o.id);
  }));
}
function duracao(a, b){
  if (!a || !b) return "";
  const h = (b - a) / 36e5;
  if (h < 1) return "menos de 1 hora";
  if (h < 48) return `${Math.round(h)} hora${Math.round(h)===1?"":"s"}`;
  return `${Math.round(h/24)} dias`;
}
function verFotoGrande(src){
  const ov = document.createElement("div"); ov.className = "lightbox"; ov.tabIndex = -1;
  ov.innerHTML = `<img src="${src}" alt="Foto ampliada"><button type="button" class="btn">Fechar</button>`;
  const fechar = () => { ov.remove(); document.removeEventListener("keydown", esc2); };
  const esc2 = e => { if (e.key==="Escape") { e.stopPropagation(); fechar(); } };
  ov.addEventListener("click", fechar); document.addEventListener("keydown", esc2, true);
  document.body.appendChild(ov); ov.focus();
}
function formOS(html, onOk, rotulo){
  $("#os-form").innerHTML = `<form class="form os-subform" id="f-os2" novalidate>${html}<div class="full actions"><button class="btn primary" type="submit" id="os2-ok">${rotulo}</button><button class="btn" type="button" id="os2-no">Voltar</button><span class="hint" id="os2-msg"></span></div></form>`;
  $("#os2-no").onclick = () => { $("#os-form").innerHTML = ""; };
  $("#f-os2").addEventListener("submit", ev => { ev.preventDefault(); onOk($("#os2-msg")); });
  const f = $("#f-os2 input, #f-os2 textarea, #f-os2 select"); if (f) f.focus();
  $("#os-form").scrollIntoView({block:"nearest"});
}
function acaoOS(o, op){
  const depois = () => abrirOS(o.id);
  const atualizar = (msg, extra) => enviar($("#os2-ok") || null, msg, "osAtualizar", Object.assign({id:o.id, op}, extra), depois);
  if (op === "iniciar") { enviar(null, $("#os-msg"), "osAtualizar", {id:o.id, op}, depois); return; }
  if (op === "material") {
    fecharModal(); setTab("registrar");
    const t = can("registrar_saida") ? "saida" : "troca"; setTipo(t);
    renderOsRef(o.numero); $("#m-osref").value = o.numero;
    if (!$("#m-destino").value) $("#m-destino").value = o.local || "";
    if (!$("#m-resp").value) $("#m-resp").value = o.responsavel || S.nome;
    osRefHint(); $("#m-busca").focus();
    return;
  }
  if (op === "concluir") return formOS(`<div class="field full"><label for="os-sol">O que foi feito <span class="req">*</span></label><textarea class="input" id="os-sol" placeholder="Ex.: troquei o reator e a lâmpada tubular; testado e funcionando" maxlength="3000"></textarea></div>
      <div class="field full"><label for="os-fd">Fotos depois</label><input class="input" type="file" id="os-fd" accept="image/*" multiple></div>`, async msg => {
      const sol = $("#os-sol").value.trim(); if (!sol) { msg.className="hint err"; msg.textContent="Descreva o que foi feito."; return; }
      const arquivos = [...$("#os-fd").files].slice(0, 8);
      if (arquivos.length) { $("#os2-ok").disabled = true; await enviarFotos(o.id, "depois", arquivos, msg); }
      atualizar(msg, {solucao:sol});
    }, "Concluir OS");
  if (op === "cancelar") return formOS(`<div class="field full"><label for="os-mot">Motivo do cancelamento <span class="req">*</span></label><input class="input" id="os-mot" placeholder="Ex.: aberta em duplicidade, serviço feito por terceiro"></div>`, msg => {
      const m = $("#os-mot").value.trim(); if (!m) { msg.className="hint err"; msg.textContent="Informe o motivo."; return; }
      atualizar(msg, {motivo:m});
    }, "Cancelar OS");
  if (op === "reabrir") return formOS(`<div class="field full"><label for="os-mot">Por que reabrir?</label><input class="input" id="os-mot" placeholder="Ex.: o problema voltou"></div>`, msg => atualizar(msg, {motivo:$("#os-mot").value.trim()}), "Reabrir OS");
  if (op === "nota") return formOS(`<div class="field full"><label for="os-nota">Anotação <span class="req">*</span></label><textarea class="input" id="os-nota" placeholder="Ex.: aguardando peça; morador não estava em casa" maxlength="1000"></textarea></div>`, msg => {
      const n = $("#os-nota").value.trim(); if (!n) { msg.className="hint err"; msg.textContent="Escreva a anotação."; return; }
      atualizar(msg, {nota:n});
    }, "Salvar anotação");
  if (op === "atribuir") return formOS(`<div class="field full"><label for="os-r">Responsável</label><select class="input" id="os-r"><option value="">Sem responsável</option>${S.colab.map(c=>`<option value="${esc(c.usuario)}" ${c.usuario===o.responsavelUsuario?"selected":""}>${esc(c.nome)}</option>`).join("")}</select></div>`, msg => atualizar(msg, {responsavelUsuario:$("#os-r").value}), "Salvar");
  if (op === "editar") { formOS(camposOS(o, false), msg => { const v = lerCamposOS(msg); if (v) atualizar(msg, {os:v}); }, "Salvar alterações"); ligarPrazo(); }
}

// vínculo com OS na tela Registrar
function renderOsRef(forcar){
  const sel = $("#m-osref"); if (!sel) return;
  const cur = forcar || sel.value;
  const lista = osAbertas().sort((a,b) => String(a.numero).localeCompare(String(b.numero)));
  const extra = cur && !lista.some(o => o.numero===cur) ? S.os.filter(o => o.numero===cur) : [];
  sel.innerHTML = `<option value="">Sem OS</option>` + extra.concat(lista).map(o => `<option value="${esc(o.numero)}">${esc(o.numero)} · ${esc(o.titulo.slice(0,60))}</option>`).join("");
  sel.value = cur && [...sel.options].some(op => op.value===cur) ? cur : "";
  osRefHint();
}
function osRefHint(){
  const o = S.os.find(x => x.numero === $("#m-osref").value);
  $("#m-osref-hint").innerHTML = o ? `Local: ${esc(o.local)} · <button type="button" class="link" data-os="${esc(o.id)}">ver a OS</button>` : "";
}
$("#m-osref").addEventListener("change", () => {
  const o = S.os.find(x => x.numero === $("#m-osref").value);
  if (o && !$("#m-destino").value) $("#m-destino").value = o.local || "";
  osRefHint();
});

// ---------- dashboard: ordens de serviço ----------
function renderDashOS(R){
  const bloco = $("#d-os-bloco");
  if (!R.os) { bloco.hidden = true; return; }
  bloco.hidden = false;
  const noPer = s => { const d = String(s||"").slice(0,10); return d && d >= R.de && d <= R.ate; };
  const abertasPer = R.os.filter(o => noPer(o.abertaEm));
  const conclPer = R.os.filter(o => o.status==="Concluída" && noPer(o.concluidaEm));
  const emAberto = R.os.filter(o => !osEncerrada(o));
  const atras = emAberto.filter(osAtrasada);
  const horas = conclPer.map(o => (dt(o.concluidaEm) - dt(o.abertaEm)) / 36e5).filter(h => h >= 0);
  const media = horas.length ? horas.reduce((s,h)=>s+h,0) / horas.length : null;
  const noPrazo = conclPer.filter(o => o.prazo && String(o.concluidaEm).slice(0,10) <= o.prazo).length;
  const fH = h => h === null ? "—" : h < 48 ? `${fNum(Math.round(h))} h` : `${fNum(Math.round(h/24*10)/10)} dias`;
  const kpi = (lbl, val, sub, cls) => `<div class="kpi static ${cls||""}"><span class="lbl">${lbl}</span><span class="val">${val}</span><span class="sub">${sub}</span></div>`;
  $("#d-os-kpis").innerHTML = [
    kpi("OS abertas", abertasPer.length, "no período"),
    kpi("OS concluídas", conclPer.length, "no período"),
    kpi("Em aberto agora", emAberto.length, `${emAberto.filter(o=>o.status==="Em andamento").length} em andamento`),
    kpi("Atrasadas agora", atras.length, "prazo vencido e ainda abertas", atras.length?"crit":""),
    kpi("Tempo médio até concluir", fH(media), horas.length ? (horas.length===1 ? "em 1 OS concluída" : `em ${horas.length} OS concluídas`) : "nenhuma OS concluída no período"),
    kpi("Concluídas no prazo", conclPer.length ? Math.round(noPrazo/conclPer.length*100)+"%" : "—", conclPer.length ? `${noPrazo} de ${conclPer.length}` : "nenhuma OS concluída no período")
  ].join("");
  const conta = (lista, chave) => { const m = {}; lista.forEach(o => { const k = String(chave(o)||"").trim() || "Não informado"; m[k] = m[k] || {v:0}; m[k].v++; }); return m; };
  barras("#d-os-cat", topN(conta(abertasPer, o=>o.categoria), 10).map(([k,o]) => ({rotulo:k, v:o.v, txt:String(o.v), tip:[["OS abertas", String(o.v)]]})), "Nenhuma OS aberta no período.");
  barras("#d-os-local", topN(conta(abertasPer, o=>o.local), 10).map(([k,o]) => ({rotulo:k, v:o.v, txt:String(o.v), tip:[["OS abertas", String(o.v)]]})), "Nenhuma OS aberta no período.");
  barras("#d-os-colab", topN(conta(conclPer, o=>o.responsavel||o.concluidaPor), 10).map(([k,o]) => ({rotulo:k, v:o.v, txt:String(o.v), tip:[["OS concluídas", String(o.v)]]})), "Nenhuma OS concluída no período.");
  const custo = {};
  R.os.forEach(o => {
    const v = (o.materiais||[]).filter(m => !m.estornado && (m.tipo==="saida"||m.tipo==="troca")).reduce((s,m) => s + (R.preco[m.itemId]||0) * Number(m.qtd||0), 0);
    if (v > 0) custo[o.numero + " · " + o.titulo] = {v};
  });
  barras("#d-os-custo", topN(custo, 10).map(([k,o]) => ({rotulo:k, v:o.v, txt:fBRL(o.v), tip:[["em material", fBRL(o.v)]]})), "Sem custo calculado: registre entradas com valor para os itens usados nas OS.");
  $("#d-os-atras").innerHTML = atras.length ? atras.sort(ordemOS).map(o => `<tr class="click" data-os="${esc(o.id)}"><td class="mono">${esc(o.numero)}</td><td><b>${esc(o.titulo)}</b><span class="sub">${esc(o.local||"")}</span></td><td>${esc(o.responsavel||"—")}</td><td class="n">${Math.max(1, Math.round((new Date(hoje()) - new Date(o.prazo)) / 864e5))} d</td></tr>`).join("")
    : `<tr><td colspan="4"><div class="empty">Nenhuma OS atrasada.</div></td></tr>`;
}

// ---------- importação de inventário ----------
let xlsxPronto = null;
function carregarXLSX(){
  if (window.XLSX) return Promise.resolve();
  if (!xlsxPronto) xlsxPronto = new Promise((ok, erro) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = ok; s.onerror = () => { xlsxPronto = null; erro(new Error("Não foi possível carregar o leitor de planilhas. Verifique a internet.")); };
    document.head.appendChild(s);
  });
  return xlsxPronto;
}
const cab = s => norm(String(s ?? "")).replace(/[^a-z0-9]+/g, " ").trim();
function mapaColunas(row){
  const h = row.map(cab), achar = t => h.findIndex(t);
  const m = {
    codigo: achar(x => x.startsWith("codigo")),
    nome: achar(x => ["item","nome","nome do item","descricao","material","produto"].includes(x)),
    espec: achar(x => x.startsWith("especifica")),
    categoria: achar(x => x === "categoria"),
    tipo: achar(x => x === "tipo" || x === "tipo do item"),
    unidade: achar(x => ["un","und","unid","unidade"].includes(x)),
    minimo: achar(x => x.includes("minimo")),
    local: achar(x => x.startsWith("localiza") || x === "local"),
    obs: achar(x => x.startsWith("observ")),
    conferir: achar(x => x === "conferir")
  };
  m.qtd = achar(x => x.startsWith("saldo"));
  if (m.qtd < 0) m.qtd = achar(x => (x.startsWith("qtd") || x.startsWith("quantidade") || x.startsWith("contagem") || x === "estoque" || x.startsWith("estoque atual")) && !x.includes("minimo"));
  return m;
}
function lerPlanilha(wb){
  let melhor = null;
  wb.SheetNames.forEach(nome => {
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nome], {header:1, raw:true, defval:""});
    for (let i = 0; i < Math.min(25, linhas.length); i++) {
      const m = mapaColunas(linhas[i]);
      if (m.nome < 0 || m.qtd < 0) continue;
      const itens = [];
      const num = v => typeof v === "number" ? v : pQtd(String(v).trim());
      for (const r of linhas.slice(i+1)) {
        const base = String(r[m.nome] ?? "").trim();
        if (!base) continue;
        const espec = m.espec >= 0 ? String(r[m.espec] ?? "").trim() : "";
        let un = m.unidade >= 0 ? String(r[m.unidade] ?? "").trim().toLowerCase() : "";
        if (!un || /^\d+([.,]\d+)?$/.test(un)) un = "un";
        const q = r[m.qtd] === "" ? 0 : num(r[m.qtd]);
        const mn = m.minimo >= 0 && r[m.minimo] !== "" ? num(r[m.minimo]) : "";
        const conf = m.conferir >= 0 && /^s/i.test(String(r[m.conferir]).trim());
        const obs = [m.obs >= 0 ? String(r[m.obs] ?? "").trim() : "", conf ? "Conferir com a contagem física." : ""].filter(Boolean).join(" ");
        itens.push({
          codigo: m.codigo >= 0 ? String(r[m.codigo] ?? "").trim() : "",
          nome: espec ? `${base} – ${espec}` : base,
          categoria: m.categoria >= 0 ? String(r[m.categoria] ?? "").trim() : "",
          tipoItem: m.tipo >= 0 ? String(r[m.tipo] ?? "").trim() : "",
          unidade: un, qtd: q, minimo: Number.isFinite(mn) ? mn : "", 
          local: m.local >= 0 ? String(r[m.local] ?? "").trim() : "", obs
        });
      }
      if (!melhor || itens.length > melhor.itens.length) melhor = {aba:nome, itens};
      break;
    }
  });
  return melhor;
}
function abrirImportacao(){
  if (!can("itens_editar")) return;
  const hojeBR = fData(hoje());
  $("#modal-box").innerHTML = `
    <h3>Importar inventário</h3>
    <p class="muted">Envie a planilha da contagem (.xlsx ou .csv). O sistema procura as colunas de código, item, quantidade (de preferência "Saldo atual"), categoria, unidade, mínimo e local.</p>
    <form class="form" id="f-imp" novalidate>
      <div class="field full"><label for="imp-arq">Planilha</label><input class="input" type="file" id="imp-arq" accept=".xlsx,.xls,.csv"></div>
      <div class="field full"><label for="imp-mot">Motivo no histórico</label><input class="input" id="imp-mot" value="Inventário ${hojeBR}"></div>
      <div class="full" id="imp-prev"></div>
      <div class="full actions"><button class="btn primary" type="submit" id="imp-ok" disabled>Importar</button><button class="btn" type="button" id="imp-no">Cancelar</button><span class="hint" id="imp-msg"></span></div>
    </form>`;
  $("#modal").hidden = false;
  $("#imp-no").onclick = fecharModal;
  let lido = null;
  const prever = () => {
    if (!lido) return;
    const modo = ($("input[name=imp-modo]:checked") || {}).value || "atualizar";
    const porCod = new Map(itensArr().filter(i=>i.codigo).map(i => [String(i.codigo).toUpperCase(), i]));
    const codsArq = new Set(lido.itens.map(l => String(l.codigo).toUpperCase()).filter(Boolean));
    let novos = 0, mudam = 0, iguais = 0; const mud = [];
    lido.itens.forEach(l => {
      const it = l.codigo && porCod.get(String(l.codigo).toUpperCase());
      if (!it) { novos++; return; }
      if (Number(it.qtd) !== Number(l.qtd)) { mudam++; mud.push({l, it}); } else iguais++;
    });
    const saem = modo === "substituir" ? itensArr().filter(i => !codsArq.has(String(i.codigo).toUpperCase())) : [];
    const semCod = lido.itens.filter(l => !l.codigo).length;
    const duvidas = lido.itens.filter(l => /\(\?\)/.test(l.nome));
    $("#imp-prev").innerHTML = `
      <div class="imp-resumo"><span>Aba <b>${esc(lido.aba)}</b>: <b>${lido.itens.length}</b> itens</span><span><b>${novos}</b> novos</span><span><b>${mudam}</b> com quantidade diferente</span><span><b>${iguais}</b> iguais</span>${modo==="substituir"?`<span><b>${saem.length}</b> saem do cadastro</span>`:""}</div>
      <fieldset class="perm-g imp-modo"><legend>Itens que já estão no sistema e não aparecem na planilha</legend>
        <label class="perm"><input type="radio" name="imp-modo" value="atualizar" ${modo==="atualizar"?"checked":""}> Manter na lista (só atualizar e acrescentar)</label>
        <label class="perm"><input type="radio" name="imp-modo" value="substituir" ${modo==="substituir"?"checked":""}> Tirar da lista: a planilha passa a ser o cadastro completo</label>
      </fieldset>
      ${semCod ? `<p class="hint">${semCod} itens sem código vão receber um código automático.</p>` : ""}
      ${duvidas.length ? `<p class="hint">${duvidas.length} itens têm "(?)" no nome, marcando leitura duvidosa. Dá para corrigir depois em Itens.</p>` : ""}
      ${modo==="substituir" && saem.length ? `<p class="notice warn">Vão sair da lista: ${esc(saem.slice(0,12).map(i=>i.nome).join(", "))}${saem.length>12?` e mais ${saem.length-12}`:""}. O histórico deles continua guardado e a planilha guarda uma cópia da lista atual.</p>` : ""}
      ${mud.length ? `<div class="tablebox flat imp-tab"><table><thead><tr><th>Código</th><th>Item</th><th class="n">No sistema</th><th class="n">Contado</th></tr></thead><tbody>${mud.slice(0,40).map(({l,it}) => `<tr><td class="mono">${esc(l.codigo)}</td><td>${esc(it.nome)}</td><td class="n">${fNum(it.qtd)}</td><td class="n"><b>${fNum(l.qtd)}</b></td></tr>`).join("")}</tbody></table></div>` : ""}`;
    $$("input[name=imp-modo]").forEach(r => r.addEventListener("change", prever));
    $("#imp-ok").disabled = false;
  };
  $("#imp-arq").addEventListener("change", async () => {
    const f = $("#imp-arq").files[0]; if (!f) return;
    const msg = $("#imp-msg"); msg.className = "hint"; msg.innerHTML = `<span class="spin" aria-hidden="true"></span> Lendo a planilha…`;
    $("#imp-ok").disabled = true; $("#imp-prev").innerHTML = "";
    try {
      await carregarXLSX();
      const buf = await f.arrayBuffer();
      lido = lerPlanilha(XLSX.read(buf, {type:"array"}));
      if (!lido || !lido.itens.length) { lido = null; msg.className = "hint err"; msg.textContent = "Não encontrei uma tabela com colunas de item e quantidade nessa planilha."; return; }
      // primeira importação com códigos diferentes: sugere substituir
      const atuais = new Set(itensArr().map(i => String(i.codigo).toUpperCase()));
      const comuns = lido.itens.filter(l => atuais.has(String(l.codigo).toUpperCase())).length;
      msg.textContent = "";
      $("#imp-prev").innerHTML = `<input type="radio" name="imp-modo" value="${comuns < lido.itens.length/2 ? "substituir" : "atualizar"}" checked hidden>`;
      prever();
    } catch(e){ lido = null; msg.className = "hint err"; msg.textContent = e.message || "Não foi possível ler a planilha."; }
  });
  $("#f-imp").addEventListener("submit", async ev => {
    ev.preventDefault(); if (!lido) return;
    const modo = ($("input[name=imp-modo]:checked") || {}).value || "atualizar";
    await enviar($("#imp-ok"), $("#imp-msg"), "importarContagem", {linhas: lido.itens, modo, motivo: $("#imp-mot").value.trim()}, () => { fecharModal(); setTab("itens"); });
  });
}
$("#i-importar").addEventListener("click", abrirImportacao);

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
