// Testes das contas: números brasileiros, valor unitário × total, último preço e estoque.
// Uso: node tests/util.test.mjs
import assert from 'node:assert/strict';
import {parseNum, unitStr, linkValues, priceStats, stockStatus, changeText, toCsv, brl, loteLabel} from '../js/util.js';

assert.equal(parseNum('1.234,56'), 1234.56);
assert.equal(parseNum('6,49'), 6.49);
assert.equal(parseNum('6.49'), 6.49);
assert.equal(parseNum('1.250'), 1250);
assert.equal(parseNum('R$ 12'), 12);
assert.ok(Number.isNaN(parseNum('')));
assert.ok(Number.isNaN(parseNum('abc')));

assert.equal(unitStr(6.5), '6,50');
assert.equal(unitStr(10 / 3), '3,3333');
assert.equal(linkValues({qtd: '12', unit: '6,49', total: '', lastEdited: 'unit'}).total, '77,88');
assert.equal(linkValues({qtd: '3', unit: '', total: '10', lastEdited: 'total'}).unit, '3,3333');
assert.equal(linkValues({qtd: '', unit: '5', total: '', lastEdited: 'unit'}).total, '', 'sem quantidade não calcula');

const c = (id, data, loja, unit, status = 'confirmado', qtd = 1) => ({id, data_compra: data, fornecedor: loja, valor_unitario: unit, valor_total: unit * qtd, quantidade: qtd, lote_status: status});
const st = priceStats([c(1, '2026-10-01', 'Atacadão', 6.49, 'confirmado', 12), c(2, '2026-11-01', 'Assaí', 5.99, 'confirmado', 6), c(3, '2026-11-03', 'Feira', 9, 'rascunho')]);
assert.equal(st.last.valor_unitario, 5.99, 'último preço vem de lote confirmado');
assert.equal(st.prev.valor_unitario, 6.49);
assert.equal(st.min.fornecedor, 'Assaí');
assert.equal(st.stores[0].fornecedor, 'Assaí');
assert.equal(st.all.length, 3, 'histórico mostra também o rascunho');
assert.equal(Math.round(st.avg * 10000) / 10000, Math.round((6.49 * 12 + 5.99 * 6) / 18 * 10000) / 10000);
assert.equal(changeText(st.change).text, '▼ 7,7% mais barato');
const draftOnly = priceStats([c(9, '2026-11-02', 'Feira', 8, 'rascunho')]);
assert.ok(draftOnly.onlyDraft); assert.equal(draftOnly.last.valor_unitario, 8);
// Mesmo dia: vale o lançamento mais recente.
assert.equal(priceStats([c(1, '2026-11-01', 'A', 1), c(2, '2026-11-01', 'B', 2)]).last.fornecedor, 'B');

assert.equal(stockStatus({saldo: 0, estoque_minimo: 0, comprado: 0, saido: 0}).key, 'novo');
assert.equal(stockStatus({saldo: 0, estoque_minimo: 0, comprado: 5, saido: 5}).key, 'zerado');
assert.equal(stockStatus({saldo: 3, estoque_minimo: 5, comprado: 8, saido: 5}).key, 'baixo');
assert.equal(stockStatus({saldo: 6, estoque_minimo: 5, comprado: 6, saido: 0}).key, 'ok');

const csv = toCsv([{a: 'Leite; "Moça"', b: 6.49}], [['a', 'Item'], ['b', 'Valor']]);
assert.equal(csv, '﻿Item;Valor\r\n"Leite; ""Moça""";6,49');
assert.match(brl(0.3333, {unit: true}), /0,3333/);
assert.equal(loteLabel(7), 'Lote Nº 0007');
console.log('util: ok');
