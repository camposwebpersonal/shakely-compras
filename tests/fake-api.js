// Banco simulado em memória para os testes de navegador (nada é enviado ao Supabase).
// Reproduz as regras do banco real: lote confirmado travado, estoque sem saldo negativo, etc.
(() => {
  const db = {produtos: [], fornecedores: [], lotes: [], compras: [], saidas: [], usuarios_autorizados: [{email: 'teste@shakely.com', nome: 'Teste'}]};
  const seq = {produtos: 0, fornecedores: 0, lotes: 0, compras: 0, saidas: 0};
  const err = (message, code = 'P0001') => Object.assign(new Error(message), {code});
  const email = 'teste@shakely.com';
  const session = {user: {email}};
  const loggedIn = () => sessionStorage.getItem('fake-logged') !== '0';
  const now = () => new Date().toISOString();
  const key = {produtos: 'id', fornecedores: 'id', lotes: 'numero', compras: 'id', saidas: 'id', usuarios_autorizados: 'email'};
  const loteOf = n => db.lotes.find(l => l.numero === n);
  const saldo = pid => db.compras.filter(c => c.produto_id === pid && loteOf(c.lote_numero)?.status === 'confirmado').reduce((s, c) => s + +c.quantidade, 0)
    - db.saidas.filter(s => s.produto_id === pid).reduce((s, x) => s + +x.quantidade, 0);
  const views = {
    v_compras: () => db.compras.map(c => { const l = loteOf(c.lote_numero), p = db.produtos.find(x => x.id === c.produto_id), f = db.fornecedores.find(x => x.id === c.fornecedor_id);
      return {...c, lote_status: l.status, produto: p.nome, unidade: p.unidade, fornecedor: f.nome}; }).sort((a, b) => b.data_compra.localeCompare(a.data_compra) || b.id - a.id),
    v_lotes: () => db.lotes.map(l => { const cs = db.compras.filter(c => c.lote_numero === l.numero);
      return {...l, itens: cs.length, total: cs.reduce((s, c) => s + +c.valor_total, 0), fornecedores: [...new Set(cs.map(c => db.fornecedores.find(f => f.id === c.fornecedor_id).nome))].sort().join(', ') || null}; }).sort((a, b) => b.numero - a.numero),
    v_estoque: () => db.produtos.map(p => {
      const conf = db.compras.filter(c => c.produto_id === p.id && loteOf(c.lote_numero).status === 'confirmado');
      const comprado = conf.reduce((s, c) => s + +c.quantidade, 0), gasto = conf.reduce((s, c) => s + +c.valor_total, 0);
      const saido = db.saidas.filter(s => s.produto_id === p.id).reduce((s, x) => s + +x.quantidade, 0);
      const u = [...conf].sort((a, b) => b.data_compra.localeCompare(a.data_compra) || b.id - a.id)[0];
      return {produto_id: p.id, produto: p.nome, unidade: p.unidade, estoque_minimo: p.estoque_minimo, ativo: p.ativo, comprado, saido, saldo: comprado - saido,
        custo_medio: comprado > 0 ? gasto / comprado : null, ultimo_preco: u?.valor_unitario ?? null, ultima_compra: u?.data_compra ?? null, ultimo_fornecedor: u ? db.fornecedores.find(f => f.id === u.fornecedor_id).nome : null};
    }).sort((a, b) => a.produto.localeCompare(b.produto)),
  };
  const clone = x => JSON.parse(JSON.stringify(x));
  const delay = () => new Promise(r => setTimeout(r, 5));
  window.__FAKE_DB = db;
  window.__FAKE_API = {
    async session() { return loggedIn() ? session : null; },
    async onAuth() {},
    async signIn(e, p) { if (p !== 'segredo1') throw err('Invalid login credentials', '400'); sessionStorage.setItem('fake-logged', '1'); return {session}; },
    async signUp() { return {session: null}; },
    async resetPassword() {}, async updatePassword() {},
    async signOut() { sessionStorage.setItem('fake-logged', '0'); },
    async autorizado() { return true; },
    async list(t) { await delay(); return clone(views[t] ? views[t]() : t === 'produtos' || t === 'fornecedores' ? [...db[t]].sort((a, b) => a.nome.localeCompare(b.nome)) : t === 'saidas' ? [...db.saidas].sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id) : db[t]); },
    async insert(t, rows) {
      await delay(); const out = [];
      for (const r0 of rows) {
        const r = {...r0};
        if (t === 'produtos' || t === 'fornecedores') {
          if (db[t].some(x => x.nome.toLowerCase().trim() === r.nome.toLowerCase().trim())) throw err('duplicate', '23505');
          Object.assign(r, {id: ++seq[t], criado_em: now()}, t === 'produtos' ? {unidade: r.unidade || 'un', estoque_minimo: r.estoque_minimo ?? 0, ativo: r.ativo ?? true} : {});
        } else if (t === 'lotes') Object.assign(r, {numero: ++seq.lotes, status: 'rascunho', criado_por: email, criado_em: now(), confirmado_em: null, confirmado_por: null, data_compra: r.data_compra, descricao: r.descricao ?? null});
        else if (t === 'compras') { if (loteOf(r.lote_numero).status === 'confirmado') throw err(`O lote ${r.lote_numero} está confirmado. Reabra o lote para alterar os itens.`); r.id = ++seq.compras; }
        else if (t === 'saidas') { r.id = ++seq.saidas; r.motivo ||= 'uso'; db.saidas.push(r); if (saldo(r.produto_id) < 0) { db.saidas.pop(); throw err('Estoque insuficiente.'); } out.push(r); continue; }
        db[t].push(r); out.push(r);
      }
      return clone(out);
    },
    async update(t, k, v, patch) {
      await delay();
      const row = db[t].find(x => x[k] === v); if (!row) return [];
      if (t === 'compras' && loteOf(row.lote_numero).status === 'confirmado') throw err(`O lote ${row.lote_numero} está confirmado. Reabra o lote para alterar os itens.`);
      if (t === 'lotes' && patch.status === 'confirmado' && row.status !== 'confirmado') {
        if (!db.compras.some(c => c.lote_numero === row.numero)) throw err('Adicione pelo menos um item antes de confirmar o lote.');
        Object.assign(patch, {confirmado_em: now(), confirmado_por: email});
      }
      if (t === 'lotes' && patch.status === 'rascunho' && row.status === 'confirmado') {
        const before = {...row}; Object.assign(row, patch);
        const bad = db.compras.filter(c => c.lote_numero === row.numero).find(c => saldo(c.produto_id) < 0);
        if (bad) { Object.assign(row, before); throw err('Não é possível reabrir: o produto já teve baixas que usam este lote.'); }
        Object.assign(row, {confirmado_em: null, confirmado_por: null}); return clone([row]);
      }
      Object.assign(row, patch); return clone([row]);
    },
    async remove(t, k, values) {
      await delay();
      if (t === 'lotes') for (const v of values) { if (loteOf(v)?.status === 'confirmado') throw err(`O lote ${v} está confirmado. Reabra o lote antes de excluir.`); db.compras = db.compras.filter(c => c.lote_numero !== v); }
      if (t === 'compras') for (const v of values) { const c = db.compras.find(x => x.id === v); if (c && loteOf(c.lote_numero).status === 'confirmado') throw err('O lote está confirmado.'); }
      db[t] = db[t].filter(x => !values.includes(x[k]));
    },
  };
})();
