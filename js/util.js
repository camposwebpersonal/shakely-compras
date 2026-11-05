// Funções puras (sem tela): números em formato brasileiro, datas, preços e estoque.

/** "1.234,56" | "1234.56" | "R$ 6,49" | "12" → número; vazio ou inválido → NaN. */
export function parseNum(value) {
  if (typeof value === 'number') return value;
  let s = String(value ?? '').replace(/R\$|\s/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // "1.250" = mil duzentos e cinquenta
  return /^-?\d*\.?\d+$/.test(s) ? Number(s) : NaN;
}

export const round = (n, d = 2) => { const f = 10 ** d; return Math.round((Number(n) + Number.EPSILON) * f) / f; };

const brlFmt = new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'});
/** Moeda; preços unitários com mais de 2 casas mostram até 4 (ex.: R$ 0,3333). */
export function brl(n, {unit = false} = {}) {
  if (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  if (unit && round(v, 2) !== round(v, 4)) {
    return 'R$ ' + v.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 4});
  }
  return brlFmt.format(v);
}

export function fmtNum(n, max = 3) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('pt-BR', {maximumFractionDigits: max});
}

/** Valor para preencher um campo de digitação: "6,49", "0,3333", "12". */
export function inputNum(n, max = 2) {
  if (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) return '';
  return Number(n).toLocaleString('pt-BR', {minimumFractionDigits: max === 2 ? 2 : 0, maximumFractionDigits: max, useGrouping: false});
}

/** Preço unitário para o campo: 2 casas quando bastam, até 4 quando necessário. */
export const unitStr = n => (n === null || n === undefined || n === '' || !Number.isFinite(Number(n))) ? '' : (round(n, 2) === round(n, 4) ? inputNum(round(n, 2), 2) : inputNum(round(n, 4), 4));

export function todayISO(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
export function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});
}
export const monthKey = iso => String(iso).slice(0, 7);
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const monthLabel = (key, long = false) => { const [y, m] = key.split('-').map(Number); return (long ? MESES_LONGOS : MESES)[m - 1] + (long ? ' de ' : '/') + (long ? y : String(y).slice(2)); };
export function lastMonths(n, from = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(from.getFullYear(), from.getMonth() - i, 1); out.push(todayISO(d).slice(0, 7)); }
  return out;
}

export const loteLabel = numero => 'Lote Nº ' + String(numero).padStart(4, '0');
export const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Mantém quantidade × valor unitário = total, recalculando o campo que o usuário NÃO digitou por último. */
export function linkValues(row) {
  const q = parseNum(row.qtd), u = parseNum(row.unit), t = parseNum(row.total);
  if (!(q > 0)) return {...row};
  if (row.lastEdited === 'total' && Number.isFinite(t)) return {...row, unit: unitStr(t / q)};
  if (Number.isFinite(u)) return {...row, total: inputNum(round(u * q, 2), 2)};
  return {...row};
}

/** Ordena compras da mais recente para a mais antiga (mesmo dia: a lançada por último primeiro). */
export const byNewest = (a, b) => String(b.data_compra).localeCompare(String(a.data_compra)) || (b.id ?? 0) - (a.id ?? 0);

/**
 * Resumo de preços de um produto a partir das compras (v_compras).
 * Último preço vem de lote confirmado; sem nenhum confirmado, usa o rascunho mais recente (marcado).
 */
export function priceStats(compras) {
  const all = [...compras].sort(byNewest);
  const conf = all.filter(c => c.lote_status === 'confirmado');
  const base = conf.length ? conf : all;
  const last = base[0] || null;
  const prev = base[1] || null;
  const change = last && prev && Number(prev.valor_unitario) > 0 ? (Number(last.valor_unitario) - Number(prev.valor_unitario)) / Number(prev.valor_unitario) : null;
  let min = null, max = null;
  for (const c of base) {
    if (!min || Number(c.valor_unitario) < Number(min.valor_unitario)) min = c;
    if (!max || Number(c.valor_unitario) > Number(max.valor_unitario)) max = c;
  }
  const qty = base.reduce((s, c) => s + Number(c.quantidade), 0);
  const spent = base.reduce((s, c) => s + Number(c.valor_total), 0);
  // Último preço em cada loja, da mais barata para a mais cara.
  const perStore = new Map();
  for (const c of base) if (!perStore.has(c.fornecedor)) perStore.set(c.fornecedor, c);
  const stores = [...perStore.values()].sort((a, b) => Number(a.valor_unitario) - Number(b.valor_unitario));
  return {all, last, prev, change, min, max, avg: qty > 0 ? spent / qty : null, qty, spent, stores, onlyDraft: !conf.length && all.length > 0, count: base.length};
}

/** Situação do estoque de um produto. */
export function stockStatus(e) {
  const saldo = Number(e.saldo), min = Number(e.estoque_minimo);
  if (!(Number(e.comprado) > 0) && !(Number(e.saido) > 0)) return {key: 'novo', label: 'Sem compra confirmada'};
  if (saldo <= 0) return {key: 'zerado', label: 'Zerado'};
  if (min > 0 && saldo <= min) return {key: 'baixo', label: 'Baixo'};
  return {key: 'ok', label: 'Em estoque'};
}

/** Variação percentual em texto: "▲ 8,2% mais caro". */
export function changeText(change) {
  if (change === null || change === undefined || !Number.isFinite(change)) return null;
  const pct = Math.abs(change * 100);
  if (pct < 0.05) return {key: 'igual', text: '= mesmo preço'};
  const v = pct.toLocaleString('pt-BR', {maximumFractionDigits: 1});
  return change > 0 ? {key: 'up', text: `▲ ${v}% mais caro`} : {key: 'down', text: `▼ ${v}% mais barato`};
}

/** CSV para Excel brasileiro: separador ";", decimal com vírgula e BOM UTF-8. */
export function toCsv(rows, columns) {
  const cell = v => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + [columns.map(c => c[1]).join(';'), ...rows.map(r => columns.map(c => cell(typeof c[0] === 'function' ? c[0](r) : r[c[0]])).join(';'))].join('\r\n');
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
