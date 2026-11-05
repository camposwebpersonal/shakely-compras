// Camada de acesso ao banco. Os testes trocam esta camada por uma simulação (window.__FAKE_API).
import {SUPABASE_URL, SUPABASE_KEY} from './config.js';

let clientPromise = null;
function client() {
  if (!clientPromise) {
    clientPromise = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
      .then(m => m.createClient(SUPABASE_URL, SUPABASE_KEY, {auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true}}));
  }
  return clientPromise;
}
const ok = ({data, error}) => { if (error) throw error; return data; };
const appUrl = () => location.origin + location.pathname;

const ORDER = {
  produtos: [['nome', true]],
  fornecedores: [['nome', true]],
  v_lotes: [['numero', false]],
  v_compras: [['data_compra', false], ['id', false]],
  v_estoque: [['produto', true]],
  saidas: [['data', false], ['id', false]],
  usuarios_autorizados: [['email', true]],
};

const realApi = {
  async session() { const c = await client(); return ok(await c.auth.getSession()).session; },
  async onAuth(cb) { const c = await client(); c.auth.onAuthStateChange((event, session) => cb(event, session)); },
  async signIn(email, password) { const c = await client(); return ok(await c.auth.signInWithPassword({email, password})); },
  async signUp(email, password) { const c = await client(); return ok(await c.auth.signUp({email, password, options: {emailRedirectTo: appUrl()}})); },
  async resetPassword(email) { const c = await client(); return ok(await c.auth.resetPasswordForEmail(email, {redirectTo: appUrl()})); },
  async updatePassword(password) { const c = await client(); return ok(await c.auth.updateUser({password})); },
  async signOut() { const c = await client(); await c.auth.signOut(); },
  async autorizado() { const c = await client(); return ok(await c.rpc('autorizado')); },
  // Lê a tabela inteira em páginas de 1000 linhas (limite padrão do Supabase).
  async list(table) {
    const c = await client(); const out = [];
    for (let from = 0; ; from += 1000) {
      let q = c.from(table).select('*').range(from, from + 999);
      for (const [col, asc] of ORDER[table] || []) q = q.order(col, {ascending: asc});
      const rows = ok(await q); out.push(...rows);
      if (rows.length < 1000) return out;
    }
  },
  async insert(table, rows) { const c = await client(); return ok(await c.from(table).insert(rows).select()); },
  async update(table, key, value, patch) { const c = await client(); return ok(await c.from(table).update(patch).eq(key, value).select()); },
  async remove(table, key, values) { const c = await client(); ok(await c.from(table).delete().in(key, values)); },
};

export const api = window.__FAKE_API || realApi;
