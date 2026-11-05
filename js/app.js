// Shakely · Controle de compras por lote, preços e estoque.
import {api} from './api.js';
import {APP_VERSION} from './config.js';
import {
  parseNum, round, brl, fmtNum, inputNum, unitStr, todayISO, fmtDate, fmtDateTime, monthKey, monthLabel, lastMonths,
  loteLabel, norm, linkValues, priceStats, stockStatus, changeText, toCsv, esc, byNewest,
} from './util.js';

const S = window.S = {
  session: null, email: '', autorizado: false, loaded: false, recovery: false,
  produtos: [], fornecedores: [], lotes: [], compras: [], estoque: [], saidas: [], usuarios: [],
  editor: null, filtroLotes: 'todos', buscaLotes: '', filtroEstoque: 'todos', buscaEstoque: '', buscaPreco: '',
};
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const root = $('#app');
const UNIDADES = ['un', 'kg', 'g', 'L', 'ml', 'cx', 'pct', 'lata', 'fardo', 'dz', 'saco', 'balde', 'pote', 'garrafa'];
const MOTIVOS = {uso: 'Uso na produção', venda: 'Venda', perda: 'Perda / vencido', ajuste: 'Ajuste de contagem'};
let uidSeq = 0; const uid = () => 'r' + (++uidSeq);

// ───────────────────────── mensagens ─────────────────────────
function friendly(e) {
  const m = String(e?.message || e || '');
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return 'Sem conexão com a internet. Verifique e tente de novo.';
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(m)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
  if (/already registered/i.test(m)) return 'Este e-mail já tem cadastro. Use “Entrar”.';
  if (/Password should be at least|weak password/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/rate limit|too many/i.test(m)) return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.';
  if (e?.code === '23505') return 'Já existe um cadastro com esse nome.';
  if (e?.code === '23503') return 'Este cadastro está em uso e não pode ser excluído.';
  if (e?.code === '42501' || /row-level security|permission denied/i.test(m)) return 'Seu e-mail não tem permissão para esta ação.';
  if (e?.code === 'P0001') return m;
  return 'Não foi possível concluir: ' + m;
}

function toast(text, kind = 'ok') {
  const box = $('#toasts') || document.body.appendChild(Object.assign(document.createElement('div'), {id: 'toasts'}));
  box.setAttribute('aria-live', 'polite');
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = text; box.appendChild(t);
  while (box.children.length > 2) box.firstElementChild.remove();
  setTimeout(() => t.classList.add('out'), kind === 'error' ? 6000 : 3200);
  setTimeout(() => t.remove(), kind === 'error' ? 6400 : 3600);
}

// Janela modal genérica. Devolve uma promessa resolvida ao fechar.
function modal(html, {onOpen, wide = false} = {}) {
  let dlg = $('#modal');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'modal'; document.body.appendChild(dlg); }
  dlg.className = wide ? 'wide' : '';
  dlg.innerHTML = html;
  return new Promise(resolve => {
    const close = value => { dlg.close(); resolve(value); };
    dlg.onclick = e => { if (e.target === dlg) close(null); const b = e.target.closest('[data-close]'); if (b) close(b.dataset.close === 'ok' ? true : null); };
    dlg.oncancel = e => { e.preventDefault(); close(null); };
    dlg.showModal();
    onOpen?.(dlg, close);
  });
}
function ask(title, text, {ok = 'Confirmar', danger = false} = {}) {
  return modal(`<form method="dialog" class="m-body"><h2>${esc(title)}</h2><p>${text}</p>
    <div class="m-actions"><button type="button" class="btn ghost" data-close>Cancelar</button>
    <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-close="ok">${esc(ok)}</button></div></form>`).then(v => v === true);
}

// ───────────────────────── autenticação ─────────────────────────
async function boot() {
  root.innerHTML = `<div class="splash"><img src="assets/logo.jpg" alt="Shakely" width="120" height="120"><p>Carregando…</p></div>`;
  try {
    await api.onAuth((event, session) => {
      if (event === 'PASSWORD_RECOVERY') { S.recovery = true; S.session = session; renderRecovery(); }
      else if (event === 'SIGNED_OUT') { S.session = null; S.loaded = false; renderLogin(); }
    });
    S.session = await api.session();
  } catch (e) { renderLogin(friendly(e)); return; }
  if (S.recovery) return renderRecovery();
  if (S.session) await enter(); else renderLogin();
}

async function enter() {
  S.email = S.session?.user?.email || '';
  try { S.autorizado = !!(await api.autorizado()); } catch (e) { renderLogin(friendly(e)); return; }
  if (!S.autorizado) return renderBlocked();
  renderShell();
  $('#view').innerHTML = '<div class="loading">Carregando dados…</div>';
  try { await reload(); } catch (e) { $('#view').innerHTML = `<div class="card empty"><p>${esc(friendly(e))}</p><button class="btn primary" onclick="location.reload()">Tentar de novo</button></div>`; return; }
  route();
}

function authCard(inner) {
  root.innerHTML = `<main class="auth"><section class="auth-card">
    <img class="auth-logo" src="assets/logo.jpg" alt="Shakely" width="132" height="132">
    <h1>Controle de Compras</h1><p class="auth-sub">Lotes, preços e estoque da Shakely</p>${inner}</section></main>`;
}

function renderLogin(msg = '', mode = 'entrar') {
  const signup = mode === 'criar';
  authCard(`<div class="tabs" role="tablist">
      <button type="button" role="tab" class="${signup ? '' : 'on'}" data-mode="entrar" aria-selected="${!signup}">Entrar</button>
      <button type="button" role="tab" class="${signup ? 'on' : ''}" data-mode="criar" aria-selected="${signup}">Criar acesso</button></div>
    <form id="authForm" class="stack" novalidate>
      <label>E-mail<input type="email" name="email" autocomplete="email" required placeholder="seu@email.com"></label>
      <label>Senha<input type="password" name="senha" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="6" placeholder="mínimo 6 caracteres"></label>
      <p class="form-msg ${msg ? 'error' : ''}" role="alert">${esc(msg)}</p>
      <button class="btn primary big" type="submit">${signup ? 'Criar meu acesso' : 'Entrar'}</button>
      ${signup ? '<p class="hint">Só e-mails autorizados pelo administrador conseguem ver os dados.</p>' : '<button type="button" class="link" id="forgot">Esqueci minha senha</button>'}
    </form>`);
  $$('[data-mode]').forEach(b => b.onclick = () => renderLogin('', b.dataset.mode));
  const form = $('#authForm'), out = $('.form-msg', form);
  const say = (text, kind = 'error') => { out.textContent = text; out.className = 'form-msg ' + kind; };
  $('#forgot')?.addEventListener('click', async () => {
    const email = form.email.value.trim();
    if (!email) return say('Digite seu e-mail acima e toque de novo em “Esqueci minha senha”.');
    try { await api.resetPassword(email); say('Enviamos um link para ' + email + ' criar uma nova senha.', 'ok'); } catch (e) { say(friendly(e)); }
  });
  form.onsubmit = async ev => {
    ev.preventDefault();
    const email = form.email.value.trim().toLowerCase(), senha = form.senha.value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return say('Digite um e-mail válido.');
    if (senha.length < 6) return say('A senha precisa ter pelo menos 6 caracteres.');
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Aguarde…';
    try {
      if (signup) {
        const r = await api.signUp(email, senha);
        if (r?.session) { S.session = r.session; return enter(); }
        authCard(`<div class="notice ok"><b>Quase lá!</b><p>Enviamos um link de confirmação para <b>${esc(email)}</b>. Abra o e-mail, toque no link e depois volte aqui para entrar.</p></div>
          <button class="btn primary big" id="backLogin">Voltar para entrar</button>`);
        $('#backLogin').onclick = () => renderLogin();
      } else {
        const r = await api.signIn(email, senha);
        S.session = r.session || await api.session();
        await enter();
      }
    } catch (e) { say(friendly(e)); btn.disabled = false; btn.textContent = signup ? 'Criar meu acesso' : 'Entrar'; }
  };
}

function renderRecovery() {
  authCard(`<form id="recForm" class="stack"><h2 class="center">Criar nova senha</h2>
    <label>Nova senha<input type="password" name="senha" autocomplete="new-password" minlength="6" required></label>
    <p class="form-msg" role="alert"></p><button class="btn primary big">Salvar nova senha</button></form>`);
  const form = $('#recForm');
  form.onsubmit = async ev => {
    ev.preventDefault();
    const out = $('.form-msg', form);
    if (form.senha.value.length < 6) { out.textContent = 'A senha precisa ter pelo menos 6 caracteres.'; out.className = 'form-msg error'; return; }
    try { await api.updatePassword(form.senha.value); S.recovery = false; toast('Senha alterada.'); history.replaceState(null, '', location.pathname); await enter(); }
    catch (e) { out.textContent = friendly(e); out.className = 'form-msg error'; }
  };
}

function renderBlocked() {
  authCard(`<div class="notice warn"><b>Acesso ainda não liberado</b><p>O e-mail <b>${esc(S.email)}</b> entrou corretamente, mas ainda não está autorizado a ver os dados da Shakely.</p>
    <p>Peça ao administrador para incluí-lo em <b>Mais → Usuários autorizados</b>.</p></div>
    <button class="btn ghost big" id="sairBloq">Sair</button>`);
  $('#sairBloq').onclick = () => api.signOut().then(() => renderLogin());
}

// ───────────────────────── dados ─────────────────────────
async function reload() {
  const [produtos, fornecedores, lotes, compras, estoque, saidas, usuarios] = await Promise.all(
    ['produtos', 'fornecedores', 'v_lotes', 'v_compras', 'v_estoque', 'saidas', 'usuarios_autorizados'].map(t => api.list(t)));
  Object.assign(S, {produtos, fornecedores, lotes, compras, estoque, saidas, usuarios, loaded: true});
  updateBadges();
}
const produtoPorNome = nome => S.produtos.find(p => norm(p.nome) === norm(nome));
const comprasDoProduto = id => S.compras.filter(c => c.produto_id === id);
const estoqueDo = id => S.estoque.find(e => e.produto_id === id);

/** Garante que os nomes existem na tabela (produtos/fornecedores) e devolve nome normalizado → id. */
async function ensureNamed(table, entries) {
  const map = new Map();
  for (const [key, extra] of entries) {
    const found = S[table].find(r => norm(r.nome) === key);
    if (found) { map.set(key, found.id); continue; }
    try {
      const [row] = await api.insert(table, [{nome: extra.nome.trim().replace(/\s+/g, ' '), ...(extra.unidade ? {unidade: extra.unidade} : {})}]);
      S[table].push(row); map.set(key, row.id);
    } catch (e) {
      if (e?.code !== '23505') throw e; // alguém cadastrou o mesmo nome ao mesmo tempo
      S[table] = await api.list(table);
      const again = S[table].find(r => norm(r.nome) === key); if (!again) throw e; map.set(key, again.id);
    }
  }
  return map;
}

// ───────────────────────── estrutura e rotas ─────────────────────────
const NAV = [['inicio', '🏠', 'Início'], ['lotes', '🧾', 'Lotes'], ['precos', '🔎', 'Preços'], ['estoque', '📦', 'Estoque'], ['mais', '⚙️', 'Mais']];

function renderShell() {
  const links = NAV.map(([id, ic, label]) => `<a href="#${id}" data-nav="${id}"><span class="ic" aria-hidden="true">${ic}</span><span>${label}</span><i class="nav-badge" data-badge="${id}" hidden></i></a>`).join('');
  root.innerHTML = `<div class="shell">
    <aside class="side"><a class="brand" href="#inicio"><img src="assets/logo.jpg" alt="" width="52" height="52"><span><b>Shakely</b><small>Controle de Compras</small></span></a>
      <a class="btn primary new-lote" href="#lote/novo">＋ Novo lote</a><nav class="side-nav">${links}</nav>
      <div class="side-user"><span>${esc(S.email)}</span></div></aside>
    <header class="top"><a class="brand" href="#inicio"><img src="assets/logo.jpg" alt="" width="40" height="40"><span><b>Shakely</b><small>Controle de Compras</small></span></a>
      <a class="btn yellow small" href="#lote/novo">＋ Lote</a></header>
    <main id="view" tabindex="-1"></main>
    <nav class="bottom">${links}</nav></div><div id="toasts" aria-live="polite"></div>`;
}

function updateBadges() {
  const rasc = S.lotes.filter(l => l.status === 'rascunho').length;
  const baixos = alertas().length;
  for (const [id, n] of [['lotes', rasc], ['estoque', baixos]]) $$(`[data-badge="${id}"]`).forEach(b => { b.hidden = !n; b.textContent = n; b.title = id === 'lotes' ? `${n} lote(s) em rascunho` : `${n} produto(s) com estoque baixo`; });
}

let skipHash = false;
window.addEventListener('hashchange', () => {
  if (skipHash) { skipHash = false; return; }
  const ed = S.editor;
  if (ed?.dirty && location.hash !== '#lote/' + (ed.numero || 'novo')) {
    if (!confirm('Há alterações neste lote que ainda não foram salvas. Sair mesmo assim?')) { skipHash = true; history.back(); return; }
    S.editor = null;
  }
  route();
});
window.addEventListener('beforeunload', e => { if (S.editor?.dirty) { e.preventDefault(); e.returnValue = ''; } });

function route() {
  if (!S.loaded) return;
  const [name, arg] = (location.hash.slice(1) || 'inicio').split('/');
  const nav = name === 'lote' ? 'lotes' : name;
  $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === nav));
  const view = $('#view');
  if (name !== 'lote') S.editor = null;
  const views = {inicio: viewInicio, lotes: viewLotes, lote: () => viewLote(arg), precos: () => viewPrecos(arg), estoque: viewEstoque, mais: viewMais};
  (views[name] || viewInicio)(view);
  view.scrollTop = 0; if (name !== 'lote' || arg !== 'novo') window.scrollTo(0, 0);
}

// ───────────────────────── Início ─────────────────────────
function alertas() {
  return S.estoque.filter(e => e.ativo !== false && (Number(e.comprado) > 0 || Number(e.estoque_minimo) > 0) && stockStatus(e).key !== 'ok');
}

function viewInicio(view) {
  const conf = S.compras.filter(c => c.lote_status === 'confirmado');
  const meses = lastMonths(6), atual = meses[5], anterior = meses[4];
  const porMes = Object.fromEntries(meses.map(m => [m, 0]));
  for (const c of conf) { const k = monthKey(c.data_compra); if (k in porMes) porMes[k] += Number(c.valor_total); }
  const varMes = porMes[anterior] > 0 ? (porMes[atual] - porMes[anterior]) / porMes[anterior] : null;
  const rascunhos = S.lotes.filter(l => l.status === 'rascunho');
  const baixos = alertas();
  const valorEstoque = S.estoque.reduce((s, e) => s + Math.max(Number(e.saldo), 0) * (Number(e.custo_medio) || 0), 0);
  const limite = todayISO(new Date(Date.now() - 90 * 864e5));
  const lojas = new Map();
  for (const c of conf) if (c.data_compra >= limite) { const l = lojas.get(c.fornecedor) || {nome: c.fornecedor, total: 0, n: 0}; l.total += Number(c.valor_total); l.n++; lojas.set(c.fornecedor, l); }
  const topLojas = [...lojas.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  const vazio = !S.lotes.length;

  view.innerHTML = `<section class="hero">
      <div class="hero-text"><h1>Quanto paguei da última vez?</h1><p>Digite o nome do item para ver o último preço, a loja e onde saiu mais barato.</p></div>
      <div class="searchbox"><span aria-hidden="true">🔎</span><input id="qInicio" type="search" placeholder="Ex.: leite condensado, copo 300ml…" autocomplete="off" aria-label="Pesquisar preço de um item"></div>
      <div id="sugInicio" class="suggestions" role="listbox"></div></section>
    ${vazio ? `<section class="card empty welcome"><h2>Bem-vinda(o) ao controle de compras da Shakely! 🍦</h2>
      <p>Comece lançando o primeiro <b>lote de compras</b>: cada lote recebe um número automático e reúne os itens comprados, a loja, a data, a quantidade e o valor.</p>
      <ol><li>Toque em <b>＋ Novo lote</b> e adicione os itens.</li><li>Salve como rascunho enquanto confere as notas.</li><li>Toque em <b>Confirmar compra</b>: os itens entram no estoque.</li></ol>
      <a class="btn primary big" href="#lote/novo">＋ Lançar o primeiro lote</a></section>` : ''}
    <section class="kpis">
      <article class="kpi pink"><span>Gasto em ${monthLabel(atual, true)}</span><b>${brl(porMes[atual])}</b><small>${varMes === null ? 'compras confirmadas' : (varMes >= 0 ? '▲ ' : '▼ ') + fmtNum(Math.abs(varMes * 100), 1) + '% vs ' + monthLabel(anterior, true)}</small></article>
      <a class="kpi yellow" href="#lotes" data-filtro="rascunho"><span>Lotes a confirmar</span><b>${rascunhos.length}</b><small>${rascunhos.length ? 'toque para conferir' : 'tudo confirmado'}</small></a>
      <a class="kpi ${baixos.length ? 'red' : 'green'}" href="#estoque" data-estoque="alerta"><span>Estoque baixo</span><b>${baixos.length}</b><small>${baixos.length ? 'produto(s) para repor' : 'nenhum alerta'}</small></a>
      <article class="kpi blue"><span>Valor em estoque</span><b>${brl(valorEstoque)}</b><small>pelo custo médio</small></article>
    </section>
    <div class="cols">
      <section class="card"><h2>Gastos por mês</h2>${chartMeses(meses, porMes)}</section>
      <section class="card"><h2>Onde mais comprou <small>(90 dias)</small></h2>${topLojas.length ? `<ul class="rank">${topLojas.map((l, i) => `<li><span class="pos">${i + 1}</span><span class="grow">${esc(l.nome)}<small>${l.n} item(ns)</small></span><b>${brl(l.total)}</b></li>`).join('')}</ul>` : '<p class="muted">Ainda não há compras confirmadas nos últimos 90 dias.</p>'}</section>
    </div>
    <div class="cols">
      <section class="card"><h2>Lotes a confirmar</h2>${rascunhos.length ? `<div class="list">${rascunhos.slice(0, 5).map(loteCard).join('')}</div>` : '<p class="muted">Nenhum lote em rascunho.</p>'}</section>
      <section class="card"><h2>Repor estoque</h2>${baixos.length ? `<ul class="mini-stock">${baixos.slice(0, 6).map(e => `<li><a href="#precos/${e.produto_id}"><span class="grow">${esc(e.produto)}</span><span class="badge ${stockStatus(e).key}">${fmtNum(e.saldo)} ${esc(e.unidade)}</span></a></li>`).join('')}</ul>` : '<p class="muted">Nenhum produto abaixo do mínimo.</p>'}</section>
    </div>`;
  bindSearch($('#qInicio'), $('#sugInicio'));
  $$('[data-filtro]', view).forEach(a => a.onclick = () => { S.filtroLotes = a.dataset.filtro; });
  $$('[data-estoque]', view).forEach(a => a.onclick = () => { S.filtroEstoque = 'alerta'; });
}

function chartMeses(meses, valores) {
  const max = Math.max(...meses.map(m => valores[m]), 1);
  const W = 360, H = 200, pad = 10, bw = (W - pad * 2) / meses.length;
  const bars = meses.map((m, i) => {
    const v = valores[m], h = Math.round((v / max) * (H - 66)), x = pad + i * bw + bw * .18, y = H - 34 - h, last = i === meses.length - 1;
    return `<g><rect x="${x}" y="${y}" width="${bw * .64}" height="${Math.max(h, v ? 3 : 1)}" rx="8" class="${last ? 'bar-now' : 'bar'}"><title>${monthLabel(m, true)}: ${brl(v)}</title></rect>
      ${v ? `<text x="${x + bw * .32}" y="${y - 8}" class="bar-val">${brl(v).replace('R$ ', '')}</text>` : ''}
      <text x="${x + bw * .32}" y="${H - 12}" class="bar-lbl">${monthLabel(m)}</text></g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gastos confirmados nos últimos 6 meses">${bars}</svg>`;
}

// Pesquisa de preço com sugestões instantâneas (usada no Início e em Preços).
function searchResults(q, limit = 8) {
  const n = norm(q); if (!n) return [];
  const words = n.split(' ');
  return S.produtos.filter(p => { const nm = norm(p.nome); return words.every(w => nm.includes(w)); })
    .sort((a, b) => norm(a.nome).indexOf(n) - norm(b.nome).indexOf(n) || a.nome.localeCompare(b.nome))
    .slice(0, limit).map(p => ({p, st: priceStats(comprasDoProduto(p.id))}));
}
function suggestionHtml({p, st}) {
  const last = st.last;
  return `<a class="sug" href="#precos/${p.id}" role="option"><span class="grow"><b>${esc(p.nome)}</b>
    <small>${last ? `${esc(last.fornecedor)} · ${fmtDate(last.data_compra)}${st.onlyDraft ? ' · rascunho' : ''}` : 'ainda sem compras'}</small></span>
    <span class="sug-price">${last ? brl(last.valor_unitario, {unit: true}) + `<small>/${esc(p.unidade)}</small>` : '—'}</span></a>`;
}
function bindSearch(input, box) {
  const paint = () => {
    const q = input.value; S.buscaPreco = q;
    const res = searchResults(q, 6);
    box.innerHTML = !q.trim() ? '' : res.length ? res.map(suggestionHtml).join('') : `<p class="sug-empty">Nenhum item com “${esc(q)}”.</p>`;
  };
  input.addEventListener('input', paint);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { const first = box.querySelector('.sug'); if (first) location.hash = first.getAttribute('href'); } });
}

// ───────────────────────── Lotes ─────────────────────────
function loteCard(l) {
  return `<a class="lote-card ${l.status}" href="#lote/${l.numero}">
    <span class="lote-num"><small>Lote Nº</small>${String(l.numero).padStart(4, '0')}</span>
    <span class="lote-info"><b>${fmtDate(l.data_compra)}${l.descricao ? ' · ' + esc(l.descricao) : ''}</b><small>${l.itens} item(ns)${l.fornecedores ? ' · ' + esc(l.fornecedores) : ''}</small></span>
    <span class="lote-total"><b>${brl(l.total)}</b><span class="badge ${l.status}">${l.status === 'confirmado' ? '✔ Confirmado' : '✎ Rascunho'}</span></span></a>`;
}

function viewLotes(view) {
  const f = S.filtroLotes, q = norm(S.buscaLotes);
  const count = k => S.lotes.filter(l => k === 'todos' || l.status === k).length;
  const lista = S.lotes.filter(l => (f === 'todos' || l.status === f) && (!q || norm(`${l.numero} ${String(l.numero).padStart(4, '0')} ${l.descricao || ''} ${l.fornecedores || ''} ${fmtDate(l.data_compra)} ${S.compras.filter(c => c.lote_numero === l.numero).map(c => c.produto).join(' ')}`).includes(q)));
  view.innerHTML = `<header class="page-head"><div><h1>Lotes de compra</h1><p>Cada lote recebe um número automático e sequencial.</p></div><a class="btn primary" href="#lote/novo">＋ Novo lote</a></header>
    <div class="toolbar"><div class="chips" role="tablist">${[['todos', 'Todos'], ['rascunho', 'Rascunho'], ['confirmado', 'Confirmados']].map(([k, t]) => `<button type="button" class="chip ${f === k ? 'on' : ''}" data-f="${k}">${t} <span>${count(k)}</span></button>`).join('')}</div>
      <input type="search" id="qLotes" placeholder="Buscar por nº, loja, item ou data" value="${esc(S.buscaLotes)}" aria-label="Buscar lotes"></div>
    <div class="list" id="listaLotes">${lista.length ? lista.map(loteCard).join('') : `<div class="card empty"><p>${S.lotes.length ? 'Nenhum lote encontrado com esse filtro.' : 'Nenhum lote lançado ainda.'}</p><a class="btn primary" href="#lote/novo">＋ Novo lote</a></div>`}</div>`;
  $$('[data-f]', view).forEach(b => b.onclick = () => { S.filtroLotes = b.dataset.f; viewLotes(view); });
  const qi = $('#qLotes'); qi.oninput = () => { S.buscaLotes = qi.value; const pos = qi.selectionStart; viewLotes(view); const n = $('#qLotes'); n.focus(); n.setSelectionRange(pos, pos); };
}

// ───────────────────────── Editor do lote ─────────────────────────
function emptyRow(prev) {
  return {key: uid(), id: null, produto: '', fornecedor: prev?.fornecedor || '', data: S.editor?.data || todayISO(), qtd: '', unit: '', total: '', unidade: 'un', lastEdited: 'unit'};
}
function rowFromCompra(c) {
  const r = {key: uid(), id: c.id, produto: c.produto, fornecedor: c.fornecedor, data: c.data_compra, qtd: inputNum(c.quantidade, 3), unit: unitStr(c.valor_unitario), total: inputNum(c.valor_total, 2), unidade: c.unidade, lastEdited: 'unit'};
  r.orig = JSON.stringify(rowPayloadKey(r)); return r;
}
const rowPayloadKey = r => [norm(r.produto), norm(r.fornecedor), r.data, parseNum(r.qtd), parseNum(r.unit), parseNum(r.total)];
const rowIsBlank = r => !r.produto.trim() && !r.fornecedor.trim() && !String(r.qtd).trim() && !String(r.unit).trim() && !String(r.total).trim();

function viewLote(arg, {copyFrom} = {}) {
  const view = $('#view');
  if (arg === 'novo') {
    if (!S.editor || S.editor.numero) {
      S.editor = {numero: null, data: todayISO(), desc: '', status: 'rascunho', rows: [], removed: [], dirty: false};
      if (copyFrom) { S.editor.rows = copyFrom.map(c => ({...rowFromCompra(c), id: null, orig: null, data: S.editor.data})); S.editor.dirty = true; }
      else S.editor.rows = [emptyRow()];
    }
  } else {
    const numero = Number(arg), lote = S.lotes.find(l => l.numero === numero);
    if (!lote) { view.innerHTML = `<div class="card empty"><p>Lote ${esc(arg)} não encontrado.</p><a class="btn primary" href="#lotes">Ver lotes</a></div>`; return; }
    if (!S.editor || S.editor.numero !== numero || !S.editor.dirty) {
      S.editor = {numero, lote, data: lote.data_compra, desc: lote.descricao || '', status: lote.status, removed: [], dirty: false,
        rows: S.compras.filter(c => c.lote_numero === numero).sort((a, b) => a.id - b.id).map(rowFromCompra)};
      if (!S.editor.rows.length && lote.status === 'rascunho') S.editor.rows = [emptyRow()];
    }
  }
  renderEditor(view);
}

function renderEditor(view) {
  const ed = S.editor, locked = ed.status === 'confirmado', l = ed.lote;
  view.innerHTML = `<form class="editor ${locked ? 'locked' : ''}" id="editor" autocomplete="off" novalidate>
    <section class="card ed-head">
      <a class="back" href="#lotes">← Lotes</a>
      <div class="ed-title"><h1>${ed.numero ? loteLabel(ed.numero) : 'Novo lote'}</h1>
        <span class="badge ${ed.status}">${locked ? '✔ Confirmado' : '✎ Rascunho'}</span></div>
      <p class="muted">${ed.numero ? `Criado por ${esc(l?.criado_por || '—')} em ${fmtDateTime(l?.criado_em)}${locked ? ` · confirmado por ${esc(l?.confirmado_por || '—')} em ${fmtDateTime(l?.confirmado_em)}` : ''}` : 'O número do lote é gerado automaticamente quando você salvar.'}</p>
      <div class="grid2">
        <label>Data da compra<input type="date" id="edData" value="${esc(ed.data)}" ${locked ? 'disabled' : ''} required></label>
        <label><span>Descrição <span class="opt">(opcional)</span></span><input id="edDesc" value="${esc(ed.desc)}" placeholder="Ex.: reposição da semana" maxlength="120" ${locked ? 'disabled' : ''}></label>
      </div>
      ${locked ? '<p class="notice info">🔒 Lote confirmado: os itens já estão no estoque. Para corrigir algo, toque em <b>Reabrir lote</b>.</p>' : ''}
    </section>
    <datalist id="dlProdutos">${S.produtos.filter(p => p.ativo !== false).map(p => `<option value="${esc(p.nome)}"></option>`).join('')}</datalist>
    <datalist id="dlLojas">${S.fornecedores.map(f => `<option value="${esc(f.nome)}"></option>`).join('')}</datalist>
    <section class="items" id="items">${ed.rows.map((r, i) => rowHtml(r, i, locked)).join('')}</section>
    ${locked ? '' : '<button type="button" class="btn add-row" data-act="addRow">＋ Adicionar item</button>'}
    <footer class="ed-foot"><div class="ed-sum" id="edSum"></div><div class="ed-actions">${locked
      ? `<button type="button" class="btn ghost" data-act="print">🖨 Imprimir</button><button type="button" class="btn ghost" data-act="repeat">↻ Repetir compra</button><button type="button" class="btn yellow" data-act="reopen">↩ Reabrir lote</button>`
      : `${ed.numero ? '<button type="button" class="btn danger-ghost" data-act="delete">Excluir</button>' : ''}<button type="button" class="btn ghost" data-act="save">💾 Salvar rascunho</button><button type="button" class="btn primary" data-act="confirm">✔ Confirmar compra</button>`}</div></footer>
  </form>`;
  ed.rows.forEach(r => paintRow(r));
  paintSum();
  const form = $('#editor');
  form.addEventListener('input', onEditorInput);
  form.addEventListener('change', onEditorInput);
  form.addEventListener('click', onEditorClick);
  form.addEventListener('submit', e => e.preventDefault());
}

function rowHtml(r, i, locked) {
  const dis = locked ? 'disabled' : '';
  return `<article class="item-row" data-key="${r.key}">
    <header class="ir-head"><span class="ir-n">Item ${i + 1}</span>${locked ? '' : `<button type="button" class="ir-del" data-act="delRow" aria-label="Remover item ${i + 1}" title="Remover item">✕</button>`}</header>
    <label class="f-prod">Item<input list="dlProdutos" data-f="produto" value="${esc(r.produto)}" placeholder="Nome do produto" ${dis}></label>
    <label class="f-loja">Loja (fornecedor)<input list="dlLojas" data-f="fornecedor" value="${esc(r.fornecedor)}" placeholder="Onde comprou" ${dis}></label>
    <label class="f-data">Data da compra<input type="date" data-f="data" value="${esc(r.data)}" ${dis}></label>
    <label class="f-qtd">Quantidade<input data-f="qtd" inputmode="decimal" value="${esc(r.qtd)}" placeholder="0" ${dis}></label>
    <label class="f-unit">Valor unitário<span class="money"><i>R$</i><input data-f="unit" inputmode="decimal" value="${esc(r.unit)}" placeholder="0,00" ${dis}></span></label>
    <label class="f-total">Valor total<span class="money"><i>R$</i><input data-f="total" inputmode="decimal" value="${esc(r.total)}" placeholder="0,00" ${dis}></span></label>
    <div class="ir-hint" data-hint></div></article>`;
}

function paintRow(r) {
  const el = $(`.item-row[data-key="${r.key}"]`); if (!el) return;
  const hint = $('[data-hint]', el), ed = S.editor;
  const name = r.produto.trim();
  if (!name) { hint.innerHTML = ''; return; }
  const p = produtoPorNome(name);
  if (!p) {
    hint.innerHTML = ed.status === 'confirmado' ? '' : `<span class="tag new">Produto novo</span> será cadastrado ao salvar · unidade
      <select data-f="unidade" aria-label="Unidade do produto novo">${UNIDADES.map(u => `<option ${u === r.unidade ? 'selected' : ''}>${u}</option>`).join('')}</select>`;
    return;
  }
  r.unidade = p.unidade;
  const outras = comprasDoProduto(p.id).filter(c => c.lote_numero !== ed.numero);
  const st = priceStats(outras), u = parseNum(r.unit);
  if (!st.last) { hint.innerHTML = `<span class="muted">Primeira compra de ${esc(p.nome)} (${esc(p.unidade)}).</span>`; return; }
  const ch = Number.isFinite(u) && Number(st.last.valor_unitario) > 0 ? changeText((u - st.last.valor_unitario) / st.last.valor_unitario) : null;
  const cheaper = st.min && st.min.id !== st.last.id && Number(st.min.valor_unitario) < Number(st.last.valor_unitario);
  hint.innerHTML = `<span>Última compra: <b>${brl(st.last.valor_unitario, {unit: true})}/${esc(p.unidade)}</b> · ${esc(st.last.fornecedor)} · ${fmtDate(st.last.data_compra)}</span>
    ${ch ? `<span class="tag ${ch.key}">${ch.text}</span>` : ''}
    ${cheaper ? `<span class="muted">Mais barato já pago: ${brl(st.min.valor_unitario, {unit: true})} em ${esc(st.min.fornecedor)} (${fmtDate(st.min.data_compra)})</span>` : ''}`;
}

function paintSum() {
  const rows = S.editor.rows.filter(r => !rowIsBlank(r));
  const total = rows.reduce((s, r) => s + (parseNum(r.total) || 0), 0);
  const lojas = new Set(rows.map(r => norm(r.fornecedor)).filter(Boolean)).size;
  $('#edSum').innerHTML = `<span>${rows.length} item(ns)${lojas ? ` · ${lojas} loja(s)` : ''}</span><b>${brl(total)}</b>`;
}

function markDirty() {
  if (S.editor.status === 'confirmado') return;
  S.editor.dirty = true;
}

function onEditorInput(e) {
  const t = e.target, ed = S.editor;
  if (t.id === 'edData') {
    const old = ed.data; ed.data = t.value;
    // Itens que estavam com a data antiga do lote acompanham a nova data.
    for (const r of ed.rows) if (r.data === old || !r.data) { r.data = t.value; const inp = $(`.item-row[data-key="${r.key}"] [data-f="data"]`); if (inp) inp.value = t.value; }
    return markDirty();
  }
  if (t.id === 'edDesc') { ed.desc = t.value; return markDirty(); }
  const f = t.dataset.f, el = t.closest('.item-row'); if (!f || !el) return;
  const r = ed.rows.find(x => x.key === el.dataset.key); if (!r) return;
  if (e.type === 'change' && f !== 'unidade' && f !== 'data') { if (['qtd', 'unit', 'total'].includes(f)) tidyMoney(r, f, t); paintRow(r); return; }
  r[f] = t.value; markDirty();
  el.classList.remove('invalid');
  if (f === 'unit' || f === 'total') r.lastEdited = f;
  if (['qtd', 'unit', 'total'].includes(f)) {
    const linked = linkValues(r);
    for (const k of ['unit', 'total']) if (k !== f && linked[k] !== r[k]) { r[k] = linked[k]; const inp = $(`[data-f="${k}"]`, el); if (inp && inp !== document.activeElement) inp.value = r[k]; }
  }
  if (f === 'produto' || f === 'unit' || f === 'total' || f === 'qtd') paintRow(r);
  paintSum();
}

// Ao sair do campo, mostra o número no formato brasileiro (6,5 → 6,50).
function tidyMoney(r, f, input) {
  const v = parseNum(r[f]); if (!Number.isFinite(v)) return;
  r[f] = f === 'qtd' ? inputNum(v, 3) : f === 'unit' ? unitStr(v) : inputNum(v, 2);
  input.value = r[f];
}

async function onEditorClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const ed = S.editor, act = b.dataset.act;
  if (act === 'addRow') {
    const r = emptyRow(ed.rows[ed.rows.length - 1]); ed.rows.push(r);
    $('#items').insertAdjacentHTML('beforeend', rowHtml(r, ed.rows.length - 1, false));
    $(`.item-row[data-key="${r.key}"] [data-f="produto"]`).focus(); paintSum(); return;
  }
  if (act === 'delRow') {
    const el = b.closest('.item-row'), r = ed.rows.find(x => x.key === el.dataset.key);
    if (r.id) ed.removed.push(r.id);
    ed.rows = ed.rows.filter(x => x !== r); el.remove(); markDirty();
    if (!ed.rows.length) { const n = emptyRow(); ed.rows.push(n); $('#items').insertAdjacentHTML('beforeend', rowHtml(n, 0, false)); }
    $$('.item-row .ir-n').forEach((s, i) => s.textContent = 'Item ' + (i + 1)); paintSum(); return;
  }
  if (act === 'save') return saveLote(false);
  if (act === 'confirm') return saveLote(true);
  if (act === 'print') return window.print();
  if (act === 'repeat') {
    const itens = S.compras.filter(c => c.lote_numero === ed.numero).sort((a, b) => a.id - b.id);
    S.editor = null; skipHash = location.hash !== '#lote/novo'; location.hash = '#lote/novo';
    viewLote('novo', {copyFrom: itens});
    toast('Itens copiados para um novo lote. Ajuste preços e quantidades e salve.'); return;
  }
  if (act === 'reopen') {
    if (!await ask('Reabrir ' + loteLabel(ed.numero) + '?', 'Os itens deste lote <b>saem do estoque</b> até você confirmar de novo. Use para corrigir quantidades, preços ou lojas.', {ok: 'Reabrir lote'})) return;
    await run(b, async () => { await api.update('lotes', 'numero', ed.numero, {status: 'rascunho'}); S.editor = null; await reload(); viewLote(String(ed.numero)); toast('Lote reaberto para edição.'); });
    return;
  }
  if (act === 'delete') {
    if (!await ask('Excluir ' + loteLabel(ed.numero) + '?', 'O lote e seus itens serão apagados. O número <b>não será reutilizado</b>, para manter a sequência de controle.', {ok: 'Excluir lote', danger: true})) return;
    await run(b, async () => { await api.remove('lotes', 'numero', [ed.numero]); S.editor = null; await reload(); location.hash = '#lotes'; toast('Lote excluído.'); });
  }
}

/** Executa uma ação com o botão em estado “aguarde” e mensagem amigável em caso de erro. */
async function run(btn, fn) {
  const label = btn?.innerHTML; if (btn) { btn.disabled = true; btn.innerHTML = 'Aguarde…'; }
  try { await fn(); } catch (e) { toast(friendly(e), 'error'); } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } }
}

function validateRows() {
  const ed = S.editor, errors = [];
  if (!ed.data) errors.push(['', 'Informe a data da compra do lote.']);
  const rows = ed.rows.filter(r => !rowIsBlank(r));
  if (!rows.length) errors.push(['', 'Adicione pelo menos um item ao lote.']);
  rows.forEach(r => {
    const i = ed.rows.indexOf(r) + 1, msg = [];
    if (!r.produto.trim()) msg.push('o nome do item');
    if (!r.fornecedor.trim()) msg.push('a loja');
    if (!r.data) msg.push('a data');
    if (!(parseNum(r.qtd) > 0)) msg.push('a quantidade');
    if (!(parseNum(r.unit) >= 0) || !(parseNum(r.total) >= 0)) msg.push('o valor');
    if (msg.length) errors.push([r.key, `Item ${i}: informe ${msg.join(', ').replace(/, ([^,]*)$/, ' e $1')}.`]);
  });
  $$('.item-row.invalid').forEach(el => el.classList.remove('invalid'));
  errors.forEach(([k]) => k && $(`.item-row[data-key="${k}"]`)?.classList.add('invalid'));
  return {rows, errors};
}

async function saveLote(confirmar) {
  const ed = S.editor;
  const {rows, errors} = validateRows();
  if (errors.length) { toast(errors[0][1], 'error'); $('.item-row.invalid')?.scrollIntoView({behavior: 'smooth', block: 'center'}); return; }
  if (confirmar) {
    const total = rows.reduce((s, r) => s + parseNum(r.total), 0);
    if (!await ask(ed.numero ? `Confirmar ${loteLabel(ed.numero)}?` : 'Confirmar esta compra?',
      `${rows.length} item(ns), total de <b>${brl(total)}</b>. Os itens <b>entram no estoque</b> e o lote fica travado (você pode reabrir depois para corrigir).`, {ok: '✔ Confirmar compra'})) return;
  }
  const btns = $$('.ed-actions .btn'); btns.forEach(b => b.disabled = true);
  const main = $(`[data-act="${confirmar ? 'confirm' : 'save'}"]`), label = main?.innerHTML; if (main) main.innerHTML = 'Salvando…';
  try {
    const prodEntries = new Map(), lojaEntries = new Map();
    for (const r of rows) {
      if (!prodEntries.has(norm(r.produto))) prodEntries.set(norm(r.produto), {nome: r.produto, unidade: r.unidade || 'un'});
      if (!lojaEntries.has(norm(r.fornecedor))) lojaEntries.set(norm(r.fornecedor), {nome: r.fornecedor});
    }
    const prodIds = await ensureNamed('produtos', prodEntries), lojaIds = await ensureNamed('fornecedores', lojaEntries);
    if (!ed.numero) {
      const [l] = await api.insert('lotes', [{data_compra: ed.data, descricao: ed.desc.trim() || null}]);
      ed.numero = l.numero; ed.lote = l;
      history.replaceState(null, '', '#lote/' + l.numero);
    } else if (ed.data !== ed.lote?.data_compra || (ed.desc.trim() || null) !== (ed.lote?.descricao || null)) {
      await api.update('lotes', 'numero', ed.numero, {data_compra: ed.data, descricao: ed.desc.trim() || null});
    }
    if (ed.removed.length) { await api.remove('compras', 'id', ed.removed); ed.removed = []; }
    const payload = r => ({lote_numero: ed.numero, produto_id: prodIds.get(norm(r.produto)), fornecedor_id: lojaIds.get(norm(r.fornecedor)), data_compra: r.data,
      quantidade: round(parseNum(r.qtd), 3), valor_unitario: round(parseNum(r.unit), 4), valor_total: round(parseNum(r.total), 2)});
    for (const r of rows.filter(r => r.id && r.orig !== JSON.stringify(rowPayloadKey(r)))) { await api.update('compras', 'id', r.id, payload(r)); r.orig = JSON.stringify(rowPayloadKey(r)); }
    const novos = rows.filter(r => !r.id);
    if (novos.length) { const ins = await api.insert('compras', novos.map(payload)); ins.forEach((c, i) => { novos[i].id = c.id; novos[i].orig = JSON.stringify(rowPayloadKey(novos[i])); }); }
    if (confirmar) await api.update('lotes', 'numero', ed.numero, {status: 'confirmado'});
    const numero = ed.numero;
    S.editor = null; await reload();
    viewLote(String(numero)); updateBadges();
    toast(confirmar ? `✔ ${loteLabel(numero)} confirmado. Estoque atualizado.` : `💾 ${loteLabel(numero)} salvo como rascunho.`);
  } catch (e) {
    toast(friendly(e), 'error');
    btns.forEach(b => b.disabled = false); if (main) main.innerHTML = label;
  }
}

// ───────────────────────── Preços ─────────────────────────
function viewPrecos(arg, view = $('#view')) {
  const id = Number(arg), p = S.produtos.find(x => x.id === id);
  view.innerHTML = `<header class="page-head"><div><h1>Pesquisa de preços</h1><p>Último preço pago, variação e a loja mais barata de cada item.</p></div></header>
    <div class="searchbox big"><span aria-hidden="true">🔎</span><input id="qPreco" type="search" placeholder="Digite o nome do item" value="${esc(p ? '' : S.buscaPreco)}" autocomplete="off" aria-label="Pesquisar item"></div>
    <div id="sugPreco" class="suggestions inline"></div>
    <div id="precoDetalhe">${p ? precoDetalhe(p) : precoLista()}</div>`;
  const input = $('#qPreco'), box = $('#sugPreco');
  bindSearch(input, box);
  if (!p) { input.addEventListener('input', () => { $('#precoDetalhe').innerHTML = input.value.trim() ? '' : precoLista(); }); if (S.buscaPreco) input.dispatchEvent(new Event('input')); }
  if (!p && matchMedia('(min-width: 900px)').matches) input.focus();
}

function precoLista() {
  const recentes = [...S.compras].sort(byNewest);
  const vistos = new Set(), itens = [];
  for (const c of recentes) if (!vistos.has(c.produto_id)) { vistos.add(c.produto_id); itens.push(c.produto_id); }
  if (!itens.length) return '<div class="card empty"><p>Os preços aparecem aqui assim que você lançar o primeiro lote.</p><a class="btn primary" href="#lote/novo">＋ Novo lote</a></div>';
  return `<section class="card"><h2>Comprados recentemente</h2><div class="sug-list">${itens.slice(0, 20).map(pid => suggestionHtml({p: S.produtos.find(x => x.id === pid), st: priceStats(comprasDoProduto(pid))})).join('')}</div></section>`;
}

function precoDetalhe(p) {
  const st = priceStats(comprasDoProduto(p.id)), e = estoqueDo(p.id);
  if (!st.last) return `<section class="card empty"><h2>${esc(p.nome)}</h2><p>Ainda não há compras deste item.</p></section>`;
  const ch = changeText(st.change), u = esc(p.unidade);
  const serie = st.all.filter(c => c.lote_status === 'confirmado' || st.onlyDraft).slice().reverse();
  return `<section class="price-hero">
      <div class="ph-main"><span class="ph-label">Último preço pago${st.onlyDraft ? ' <span class="tag draft">lote em rascunho</span>' : ''}</span>
        <h2>${esc(p.nome)}</h2><b class="ph-price">${brl(st.last.valor_unitario, {unit: true})}<small>/${u}</small></b>
        <p>${esc(st.last.fornecedor)} · ${fmtDate(st.last.data_compra)} · <a href="#lote/${st.last.lote_numero}">${loteLabel(st.last.lote_numero)}</a></p>
        ${ch ? `<span class="tag ${ch.key} big">${ch.text} que a compra anterior (${brl(st.prev.valor_unitario, {unit: true})})</span>` : ''}</div>
      ${sparkline(serie)}
    </section>
    <section class="stats">
      <article><span>Menor preço</span><b>${brl(st.min.valor_unitario, {unit: true})}</b><small>${esc(st.min.fornecedor)} · ${fmtDate(st.min.data_compra)}</small></article>
      <article><span>Maior preço</span><b>${brl(st.max.valor_unitario, {unit: true})}</b><small>${esc(st.max.fornecedor)} · ${fmtDate(st.max.data_compra)}</small></article>
      <article><span>Preço médio</span><b>${brl(st.avg, {unit: true})}</b><small>ponderado por quantidade</small></article>
      <article><span>Em estoque</span><b>${e ? fmtNum(e.saldo) + ' ' + u : '—'}</b><small>${st.count} compra(s) · ${brl(st.spent)}</small></article>
    </section>
    ${st.stores.length > 1 ? `<section class="card"><h2>Último preço em cada loja</h2><ul class="stores">${st.stores.map((c, i) => `<li class="${i === 0 ? 'best' : ''}"><span class="grow"><b>${esc(c.fornecedor)}</b><small>${fmtDate(c.data_compra)}</small></span>${i === 0 ? '<span class="tag down">mais barato</span>' : `<span class="muted">+${fmtNum((c.valor_unitario / st.stores[0].valor_unitario - 1) * 100, 1)}%</span>`}<b>${brl(c.valor_unitario, {unit: true})}</b></li>`).join('')}</ul></section>` : ''}
    <section class="card"><h2>Histórico de compras</h2><div class="table-wrap"><table class="hist"><thead><tr><th>Data</th><th>Lote</th><th>Loja</th><th class="num">Qtd.</th><th class="num">Unitário</th><th class="num">Total</th></tr></thead>
      <tbody>${st.all.map(c => `<tr class="${c.lote_status}"><td>${fmtDate(c.data_compra)}</td><td><a href="#lote/${c.lote_numero}">Nº ${String(c.lote_numero).padStart(4, '0')}</a>${c.lote_status === 'rascunho' ? ' <span class="tag draft">rascunho</span>' : ''}</td><td>${esc(c.fornecedor)}</td><td class="num">${fmtNum(c.quantidade)} ${u}</td><td class="num">${brl(c.valor_unitario, {unit: true})}</td><td class="num">${brl(c.valor_total)}</td></tr>`).join('')}</tbody></table></div></section>`;
}

function sparkline(serie) {
  if (serie.length < 2) return '';
  const W = 320, H = 120, P = 16, vals = serie.map(c => Number(c.valor_unitario));
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = vals.map((v, i) => [P + i * (W - 2 * P) / (vals.length - 1), H - P - 14 - (v - min) / span * (H - 2 * P - 22)]);
  return `<figure class="spark"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução do preço unitário">
    <polyline points="${pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ')}" />
    ${pts.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${i === pts.length - 1 ? 5 : 3.5}" class="${i === pts.length - 1 ? 'now' : ''}"><title>${fmtDate(serie[i].data_compra)}: ${brl(vals[i], {unit: true})}</title></circle>`).join('')}
    <text x="${P}" y="${H - 4}">${fmtDate(serie[0].data_compra)}</text><text x="${W - P}" y="${H - 4}" text-anchor="end">${fmtDate(serie[serie.length - 1].data_compra)}</text>
  </svg><figcaption>Evolução do preço (${serie.length} compras)</figcaption></figure>`;
}

// ───────────────────────── Estoque ─────────────────────────
function viewEstoque(view) {
  const f = S.filtroEstoque, q = norm(S.buscaEstoque);
  const ativos = S.estoque.filter(e => e.ativo !== false), inativos = S.estoque.filter(e => e.ativo === false);
  const grupos = {todos: ativos, alerta: alertas(), ok: ativos.filter(e => stockStatus(e).key === 'ok'), inativos};
  const lista = (grupos[f] || ativos).filter(e => !q || norm(e.produto).includes(q));
  const totalValor = ativos.reduce((s, e) => s + Math.max(Number(e.saldo), 0) * (Number(e.custo_medio) || 0), 0);
  const chips = [['todos', 'Todos'], ['alerta', 'Repor'], ['ok', 'Em estoque'], ...(inativos.length ? [['inativos', 'Inativos']] : [])];
  view.innerHTML = `<header class="page-head"><div><h1>Estoque</h1><p>Calculado pelas compras <b>confirmadas</b> menos as baixas. Valor total: <b>${brl(totalValor)}</b></p></div></header>
    <div class="toolbar"><div class="chips">${chips.map(([k, t]) => `<button type="button" class="chip ${f === k ? 'on' : ''}" data-f="${k}">${t} <span>${grupos[k].length}</span></button>`).join('')}</div>
      <input type="search" id="qEstoque" placeholder="Buscar produto" value="${esc(S.buscaEstoque)}" aria-label="Buscar produto no estoque"></div>
    <div class="stock-grid">${lista.length ? lista.map(stockCard).join('') : `<div class="card empty"><p>${S.estoque.length ? 'Nenhum produto neste filtro.' : 'O estoque aparece aqui depois do primeiro lote confirmado.'}</p></div>`}</div>
    <section class="card"><h2>Últimas baixas</h2>${S.saidas.length ? `<ul class="saidas">${S.saidas.slice(0, 25).map(s => { const p = S.produtos.find(x => x.id === s.produto_id); return `<li><span class="grow"><b>${esc(p?.nome || '—')}</b><small>${fmtDate(s.data)} · ${esc(MOTIVOS[s.motivo] || s.motivo)}${s.observacao ? ' · ' + esc(s.observacao) : ''}</small></span><b class="neg">− ${fmtNum(s.quantidade)} ${esc(p?.unidade || '')}</b><button type="button" class="btn tiny ghost" data-undo="${s.id}" title="Desfazer baixa">Desfazer</button></li>`; }).join('')}</ul>` : '<p class="muted">Nenhuma baixa registrada. Use “Dar baixa” quando um produto for usado, vendido ou perdido.</p>'}</section>`;
  $$('[data-f]', view).forEach(b => b.onclick = () => { S.filtroEstoque = b.dataset.f; viewEstoque(view); });
  const qi = $('#qEstoque'); qi.oninput = () => { S.buscaEstoque = qi.value; const pos = qi.selectionStart; viewEstoque(view); const n = $('#qEstoque'); n.focus(); n.setSelectionRange(pos, pos); };
  $$('[data-baixa]', view).forEach(b => b.onclick = () => openBaixa(Number(b.dataset.baixa)));
  $$('[data-editp]', view).forEach(b => b.onclick = () => openProduto(Number(b.dataset.editp)));
  $$('[data-undo]', view).forEach(b => b.onclick = async () => {
    if (!await ask('Desfazer esta baixa?', 'A quantidade volta para o estoque.', {ok: 'Desfazer baixa'})) return;
    await run(b, async () => { await api.remove('saidas', 'id', [Number(b.dataset.undo)]); await reload(); viewEstoque(view); toast('Baixa desfeita.'); });
  });
}

function stockCard(e) {
  const s = stockStatus(e), min = Number(e.estoque_minimo), saldo = Number(e.saldo);
  const pct = min > 0 ? Math.min(100, Math.max(0, saldo / (min * 2) * 100)) : (saldo > 0 ? 100 : 0);
  return `<article class="stock-card ${s.key}">
    <header><h3>${esc(e.produto)}</h3><span class="badge ${s.key}">${s.label}</span></header>
    <p class="qty"><b>${fmtNum(saldo)}</b> ${esc(e.unidade)}</p>
    <div class="meter" aria-hidden="true"><i style="width:${pct}%"></i></div>
    <dl><div><dt>Mínimo</dt><dd>${min > 0 ? fmtNum(min) + ' ' + esc(e.unidade) : 'não definido'}</dd></div>
      <div><dt>Custo médio</dt><dd>${brl(e.custo_medio, {unit: true})}</dd></div>
      <div><dt>Valor em estoque</dt><dd>${brl(Math.max(saldo, 0) * (Number(e.custo_medio) || 0))}</dd></div>
      <div><dt>Última compra</dt><dd>${e.ultima_compra ? `${brl(e.ultimo_preco, {unit: true})} · ${esc(e.ultimo_fornecedor)} · ${fmtDate(e.ultima_compra)}` : '—'}</dd></div></dl>
    <footer><button type="button" class="btn small primary" data-baixa="${e.produto_id}" ${saldo > 0 ? '' : 'disabled'}>➖ Dar baixa</button>
      <button type="button" class="btn small ghost" data-editp="${e.produto_id}">✏️ Editar</button>
      <a class="btn small ghost" href="#precos/${e.produto_id}">🔎 Preços</a></footer></article>`;
}

async function openBaixa(produtoId) {
  const e = estoqueDo(produtoId); if (!e) return;
  await modal(`<form class="m-body" id="fBaixa" novalidate><h2>Dar baixa · ${esc(e.produto)}</h2>
    <p class="muted">Saldo atual: <b>${fmtNum(e.saldo)} ${esc(e.unidade)}</b></p>
    <div class="grid2"><label>Quantidade<input name="qtd" inputmode="decimal" required placeholder="0"></label>
      <label>Motivo<select name="motivo">${Object.entries(MOTIVOS).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
      <label>Data<input type="date" name="data" value="${todayISO()}" required></label>
      <label><span>Observação <span class="opt">(opcional)</span></span><input name="obs" maxlength="140"></label></div>
    <p class="form-msg" id="baixaMsg" role="alert"></p>
    <div class="m-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary" type="submit">Registrar baixa</button></div></form>`, {
    onOpen: (dlg, close) => {
      const form = $('#fBaixa', dlg), msg = $('#baixaMsg', dlg);
      form.qtd.focus();
      form.qtd.oninput = () => { const q = parseNum(form.qtd.value); msg.className = 'form-msg'; msg.textContent = q > 0 ? `Saldo após a baixa: ${fmtNum(round(Number(e.saldo) - q, 3))} ${e.unidade}` : ''; if (q > Number(e.saldo)) { msg.className = 'form-msg error'; msg.textContent = 'Quantidade maior que o saldo em estoque.'; } };
      form.onsubmit = async ev => {
        ev.preventDefault();
        const q = parseNum(form.qtd.value);
        if (!(q > 0)) { msg.className = 'form-msg error'; msg.textContent = 'Informe a quantidade.'; return; }
        if (q > Number(e.saldo)) { msg.className = 'form-msg error'; msg.textContent = 'Quantidade maior que o saldo em estoque.'; return; }
        await run(form.querySelector('[type=submit]'), async () => {
          await api.insert('saidas', [{produto_id: produtoId, quantidade: round(q, 3), motivo: form.motivo.value, data: form.data.value || todayISO(), observacao: form.obs.value.trim() || null}]);
          close(true); await reload(); route(); toast(`Baixa de ${fmtNum(q)} ${e.unidade} registrada.`);
        });
      };
    },
  });
}

async function openProduto(produtoId) {
  const p = S.produtos.find(x => x.id === produtoId); if (!p) return;
  const units = UNIDADES.includes(p.unidade) ? UNIDADES : [p.unidade, ...UNIDADES];
  await modal(`<form class="m-body" id="fProd" novalidate><h2>Editar produto</h2>
    <label>Nome<input name="nome" value="${esc(p.nome)}" required maxlength="80"></label>
    <div class="grid2"><label>Unidade<select name="unidade">${units.map(u => `<option ${u === p.unidade ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></label>
      <label>Estoque mínimo<input name="minimo" inputmode="decimal" value="${inputNum(p.estoque_minimo, 3)}" placeholder="0"></label></div>
    <label class="check"><input type="checkbox" name="ativo" ${p.ativo !== false ? 'checked' : ''}> Produto ativo (aparece nas sugestões)</label>
    <p class="hint">Com estoque mínimo definido, o produto entra em <b>Repor</b> quando o saldo chegar nele.</p>
    <p class="form-msg" role="alert"></p>
    <div class="m-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary" type="submit">Salvar</button></div></form>`, {
    onOpen: (dlg, close) => {
      const form = $('#fProd', dlg), msg = $('.form-msg', form);
      form.onsubmit = async ev => {
        ev.preventDefault();
        const nome = form.nome.value.trim().replace(/\s+/g, ' '), min = form.minimo.value.trim() ? parseNum(form.minimo.value) : 0;
        if (!nome) { msg.className = 'form-msg error'; msg.textContent = 'Informe o nome.'; return; }
        if (!(min >= 0)) { msg.className = 'form-msg error'; msg.textContent = 'Estoque mínimo inválido.'; return; }
        const dup = S.produtos.find(x => x.id !== p.id && norm(x.nome) === norm(nome));
        if (dup) { msg.className = 'form-msg error'; msg.textContent = 'Já existe um produto com esse nome.'; return; }
        await run(form.querySelector('[type=submit]'), async () => {
          await api.update('produtos', 'id', p.id, {nome, unidade: form.unidade.value, estoque_minimo: round(min, 3), ativo: form.ativo.checked});
          close(true); await reload(); route(); toast('Produto atualizado.');
        });
      };
    },
  });
}

// ───────────────────────── Mais ─────────────────────────
function viewMais(view) {
  const porLoja = new Map();
  for (const c of S.compras.filter(c => c.lote_status === 'confirmado')) { const l = porLoja.get(c.fornecedor_id) || {n: 0, total: 0}; l.n++; l.total += Number(c.valor_total); porLoja.set(c.fornecedor_id, l); }
  view.innerHTML = `<header class="page-head"><div><h1>Mais opções</h1><p>Usuários, lojas, exportação e conta.</p></div></header>
    <div class="cols">
      <section class="card"><h2>Usuários autorizados</h2><p class="muted">Só estes e-mails conseguem ver e lançar compras. A pessoa cria o próprio acesso na tela de entrada com o mesmo e-mail.</p>
        <ul class="users">${S.usuarios.map(u => `<li><span class="grow"><b>${esc(u.nome || u.email.split('@')[0])}</b><small>${esc(u.email)}</small></span>${u.email === S.email.toLowerCase() ? '<span class="tag">você</span>' : `<button type="button" class="btn tiny danger-ghost" data-rmuser="${esc(u.email)}">Remover</button>`}</li>`).join('')}</ul>
        <form id="fUser" class="inline-form" novalidate><input name="email" type="email" placeholder="e-mail da pessoa" aria-label="E-mail" required><input name="nome" placeholder="nome (opcional)" aria-label="Nome"><button class="btn primary" type="submit">Autorizar</button></form></section>
      <section class="card"><h2>Lojas (fornecedores)</h2>${S.fornecedores.length ? `<ul class="users">${S.fornecedores.map(f => { const l = porLoja.get(f.id); return `<li><span class="grow"><b>${esc(f.nome)}</b><small>${l ? `${l.n} item(ns) · ${brl(l.total)}` : 'sem compras confirmadas'}</small></span><button type="button" class="btn tiny ghost" data-renloja="${f.id}">Renomear</button></li>`; }).join('')}</ul>` : '<p class="muted">As lojas são cadastradas automaticamente ao lançar os lotes.</p>'}</section>
    </div>
    <div class="cols">
      <section class="card"><h2>Exportar planilhas</h2><p class="muted">Arquivos CSV que abrem direto no Excel ou no Google Planilhas.</p>
        <div class="btn-row"><button type="button" class="btn ghost" data-csv="compras">⬇ Compras</button><button type="button" class="btn ghost" data-csv="lotes">⬇ Lotes</button><button type="button" class="btn ghost" data-csv="estoque">⬇ Estoque</button></div></section>
      <section class="card"><h2>Sua conta</h2><p>${esc(S.email)}</p><div class="btn-row"><button type="button" class="btn ghost" id="trocarSenha">Alterar senha</button><button type="button" class="btn danger-ghost" id="sair">Sair</button></div>
        <p class="hint">Shakely · Controle de Compras · versão ${APP_VERSION}</p></section>
    </div>`;
  $('#fUser').onsubmit = async ev => {
    ev.preventDefault(); const f = ev.target, email = f.email.value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Digite um e-mail válido.', 'error');
    if (S.usuarios.some(u => u.email === email)) return toast('Este e-mail já está autorizado.', 'error');
    await run(f.querySelector('button'), async () => { await api.insert('usuarios_autorizados', [{email, nome: f.nome.value.trim() || null}]); await reload(); viewMais(view); toast(email + ' autorizado.'); });
  };
  $$('[data-rmuser]', view).forEach(b => b.onclick = async () => {
    if (!await ask('Remover acesso?', `<b>${esc(b.dataset.rmuser)}</b> não poderá mais ver nem lançar compras.`, {ok: 'Remover', danger: true})) return;
    await run(b, async () => { await api.remove('usuarios_autorizados', 'email', [b.dataset.rmuser]); await reload(); viewMais(view); toast('Acesso removido.'); });
  });
  $$('[data-renloja]', view).forEach(b => b.onclick = () => renameLoja(Number(b.dataset.renloja)));
  $$('[data-csv]', view).forEach(b => b.onclick = () => exportCsv(b.dataset.csv));
  $('#sair').onclick = async () => { await api.signOut(); S.loaded = false; renderLogin(); };
  $('#trocarSenha').onclick = () => modal(`<form class="m-body" id="fSenha"><h2>Alterar senha</h2><label>Nova senha<input type="password" name="senha" minlength="6" autocomplete="new-password" required></label><p class="form-msg" role="alert"></p>
    <div class="m-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary" type="submit">Salvar</button></div></form>`, {
    onOpen: (dlg, close) => { const f = $('#fSenha', dlg); f.onsubmit = async ev => { ev.preventDefault(); if (f.senha.value.length < 6) { const m = $('.form-msg', f); m.className = 'form-msg error'; m.textContent = 'A senha precisa ter pelo menos 6 caracteres.'; return; } await run(f.querySelector('[type=submit]'), async () => { await api.updatePassword(f.senha.value); close(true); toast('Senha alterada.'); }); }; },
  });
}

async function renameLoja(id) {
  const f = S.fornecedores.find(x => x.id === id); if (!f) return;
  await modal(`<form class="m-body" id="fLoja"><h2>Renomear loja</h2><label>Nome<input name="nome" value="${esc(f.nome)}" required maxlength="80"></label><p class="form-msg" role="alert"></p>
    <div class="m-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary" type="submit">Salvar</button></div></form>`, {
    onOpen: (dlg, close) => {
      const form = $('#fLoja', dlg), msg = $('.form-msg', form);
      form.onsubmit = async ev => {
        ev.preventDefault(); const nome = form.nome.value.trim().replace(/\s+/g, ' ');
        if (!nome) { msg.className = 'form-msg error'; msg.textContent = 'Informe o nome.'; return; }
        if (S.fornecedores.some(x => x.id !== id && norm(x.nome) === norm(nome))) { msg.className = 'form-msg error'; msg.textContent = 'Já existe uma loja com esse nome.'; return; }
        await run(form.querySelector('[type=submit]'), async () => { await api.update('fornecedores', 'id', id, {nome}); close(true); await reload(); route(); toast('Loja renomeada.'); });
      };
    },
  });
}

function exportCsv(kind) {
  const cfg = {
    compras: [S.compras, [['lote_numero', 'Lote'], [c => c.lote_status, 'Situação'], [c => fmtDate(c.data_compra), 'Data da compra'], ['produto', 'Item'], ['unidade', 'Unidade'], ['fornecedor', 'Loja'], [c => Number(c.quantidade), 'Quantidade'], [c => Number(c.valor_unitario), 'Valor unitário'], [c => Number(c.valor_total), 'Valor total']]],
    lotes: [S.lotes, [['numero', 'Lote'], [l => fmtDate(l.data_compra), 'Data'], ['descricao', 'Descrição'], ['status', 'Situação'], ['itens', 'Itens'], ['fornecedores', 'Lojas'], [l => Number(l.total), 'Total'], ['criado_por', 'Criado por'], [l => l.confirmado_em ? fmtDateTime(l.confirmado_em) : '', 'Confirmado em']]],
    estoque: [S.estoque, [['produto', 'Produto'], ['unidade', 'Unidade'], [e => Number(e.comprado), 'Comprado'], [e => Number(e.saido), 'Baixas'], [e => Number(e.saldo), 'Saldo'], [e => Number(e.estoque_minimo), 'Mínimo'], [e => e.custo_medio === null ? '' : round(e.custo_medio, 4), 'Custo médio'], [e => e.ultimo_preco === null ? '' : Number(e.ultimo_preco), 'Último preço'], ['ultimo_fornecedor', 'Última loja'], [e => e.ultima_compra ? fmtDate(e.ultima_compra) : '', 'Última compra']]],
  }[kind];
  const blob = new Blob([toCsv(cfg[0], cfg[1])], {type: 'text/csv;charset=utf-8'});
  const a = Object.assign(document.createElement('a'), {href: URL.createObjectURL(blob), download: `shakely-${kind}-${todayISO()}.csv`});
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Planilha gerada.');
}

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
boot();
