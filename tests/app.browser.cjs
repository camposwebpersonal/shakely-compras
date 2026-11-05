// Teste de ponta a ponta com banco simulado: lotes, numeração, preços, estoque, baixas,
// validações, contraste (WCAG AA) e ausência de rolagem horizontal.
// Uso: python3 -m http.server 8091 (na raiz) e NODE_PATH=$(npm root -g) W=390 node tests/app.browser.cjs
const {chromium} = require('playwright');
const assert = require('assert');
const BASE = process.env.BASE || 'http://127.0.0.1:8091';
const W = Number(process.env.W || 390);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({viewport: {width: W, height: W < 900 ? 844 : 900}, isMobile: W < 900, hasTouch: W < 900});
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.fulfill({status: 204, body: ''}));
  await page.addInitScript({path: __dirname + '/fake-api.js'});
  await page.addInitScript({path: __dirname + '/contrast-audit.js'});
  const audits = {};
  const audit = async name => {
    await page.waitForTimeout(150);
    audits[name] = await page.evaluate(() => window.__contrastAudit());
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `${name}: rolagem horizontal de ${overflow}px`);
    await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
    await page.screenshot({path: `/tmp/shakely-${name}-${W}.png`, fullPage: false});
  };
  const go = async hash => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(120); };
  const row = n => `.item-row:nth-child(${n})`;
  const okDialog = async () => { await page.click('dialog#modal [data-close="ok"]'); await page.waitForTimeout(200); };
  const toastText = async () => (await page.locator('.toast').last().textContent()).trim();

  await page.goto(BASE + '/index.html#inicio');
  await page.waitForSelector('.hero');
  assert.ok(await page.isVisible('.welcome'), 'tela de boas-vindas quando não há lotes');
  await audit('inicio-vazio');

  // Lote 1: dois itens, valores ligados (unitário ↔ total) e produto novo com unidade.
  await go('#lote/novo');
  await page.waitForSelector('#editor');
  assert.match(await page.textContent('.ed-head'), /gerado automaticamente/);
  await page.fill(`${row(1)} [data-f=produto]`, 'Leite condensado');
  await page.selectOption(`${row(1)} [data-f=unidade]`, 'lata');
  await page.fill(`${row(1)} [data-f=fornecedor]`, 'Atacadão');
  await page.fill(`${row(1)} [data-f=qtd]`, '12');
  await page.fill(`${row(1)} [data-f=unit]`, '6,49');
  assert.equal(await page.inputValue(`${row(1)} [data-f=total]`), '77,88');
  await page.click('[data-act=addRow]');
  assert.equal(await page.inputValue(`${row(2)} [data-f=fornecedor]`), 'Atacadão', 'loja do item anterior é sugerida');
  await page.fill(`${row(2)} [data-f=produto]`, 'Copo 300ml');
  await page.fill(`${row(2)} [data-f=qtd]`, '100');
  await page.fill(`${row(2)} [data-f=total]`, '25');
  assert.equal(await page.inputValue(`${row(2)} [data-f=unit]`), '0,25');
  assert.match(await page.textContent('#edSum'), /102,88/);
  await audit('editor-novo');
  await page.click('[data-act=save]');
  await page.waitForFunction(() => location.hash === '#lote/1' && document.querySelector('.ed-title h1')?.textContent.includes('0001'));
  assert.match(await toastText(), /Lote Nº 0001 salvo como rascunho/);
  assert.equal(await page.evaluate(() => window.__FAKE_DB.produtos.find(p => p.nome === 'Leite condensado').unidade), 'lata');

  await page.click('[data-act=confirm]'); await okDialog();
  await page.waitForSelector('.badge.confirmado');
  assert.ok(await page.isDisabled(`${row(1)} [data-f=produto]`), 'lote confirmado fica travado');
  await audit('editor-confirmado');

  // Lote 2: mesmo item em outra loja, mais barato — a dica compara com a última compra.
  await go('#lote/novo'); await page.waitForSelector('#editor');
  await page.fill(`${row(1)} [data-f=produto]`, 'Leite condensado');
  await page.fill(`${row(1)} [data-f=fornecedor]`, 'Assaí');
  await page.fill(`${row(1)} [data-f=qtd]`, '6');
  await page.fill(`${row(1)} [data-f=unit]`, '5,99');
  const hint = await page.textContent(`${row(1)} [data-hint]`);
  assert.match(hint, /Última compra: R\$\s?6,49\/lata · Atacadão/);
  assert.match(hint, /▼ 7,7% mais barato/);
  await page.click('[data-act=confirm]'); await okDialog();
  await page.waitForFunction(() => location.hash === '#lote/2' && document.querySelector('.badge.confirmado'));

  // Validação: item sem loja não salva.
  await go('#lote/novo'); await page.waitForSelector('#editor');
  await page.fill(`${row(1)} [data-f=produto]`, 'Morango');
  await page.fill(`${row(1)} [data-f=qtd]`, '2');
  await page.click('[data-act=save]');
  assert.match(await toastText(), /Item 1: informe a loja e o valor/);
  assert.ok(await page.isVisible('.item-row.invalid'));
  await page.fill(`${row(1)} [data-f=fornecedor]`, 'Feira');
  await page.fill(`${row(1)} [data-f=unit]`, '8');
  await page.click('[data-act=save]');
  await page.waitForFunction(() => location.hash === '#lote/3');
  // Excluir o rascunho 3: o próximo lote recebe o nº 4 (numeração não é reutilizada).
  await page.click('[data-act=delete]'); await okDialog();
  await page.waitForFunction(() => location.hash === '#lotes');
  await go('#lote/novo'); await page.waitForSelector('#editor');
  await page.fill(`${row(1)} [data-f=produto]`, 'Morango'); await page.fill(`${row(1)} [data-f=fornecedor]`, 'Feira');
  await page.fill(`${row(1)} [data-f=qtd]`, '3'); await page.fill(`${row(1)} [data-f=unit]`, '7,5');
  await page.click('[data-act=save]');
  await page.waitForFunction(() => location.hash === '#lote/4');

  await go('#lotes'); await page.waitForSelector('.lote-card');
  assert.equal(await page.locator('.lote-card').count(), 3);
  await page.click('.chip[data-f=rascunho]');
  assert.equal(await page.locator('.lote-card').count(), 1);
  await page.fill('#qLotes', 'assaí'); await page.click('.chip[data-f=todos]');
  assert.equal(await page.locator('.lote-card').count(), 1, 'busca por loja');
  await audit('lotes');

  // Início: pesquisa rápida mostra o último preço confirmado.
  await go('#inicio'); await page.waitForSelector('.kpis');
  await page.fill('#qInicio', 'leite');
  const sug = await page.textContent('#sugInicio .sug');
  assert.match(sug, /5,99/); assert.match(sug, /Assaí/);
  assert.match(await page.textContent('.kpi.yellow'), /1/);
  await audit('inicio');
  await page.click('#sugInicio .sug');

  // Preços: último preço, variação, loja mais barata e histórico.
  await page.waitForSelector('.price-hero');
  assert.match(await page.textContent('.ph-price'), /5,99/);
  assert.match(await page.textContent('.price-hero'), /▼ 7,7% mais barato/);
  assert.match(await page.textContent('.stores li.best'), /Assaí/);
  assert.equal(await page.locator('table.hist tbody tr').count(), 2);
  assert.match(await page.textContent('.stats'), /Menor preço\s*R\$\s?5,99/);
  await audit('precos');

  // Estoque: 12 + 6 latas; baixa maior que o saldo é bloqueada; baixa válida reduz.
  await go('#estoque'); await page.waitForSelector('.stock-card');
  const leite = page.locator('.stock-card', {hasText: 'Leite condensado'});
  assert.match(await leite.locator('.qty').textContent(), /18\s*lata/);
  await audit('estoque');
  await leite.locator('[data-baixa]').click();
  await page.fill('#fBaixa [name=qtd]', '20');
  await page.click('#fBaixa [type=submit]');
  assert.match(await page.textContent('#baixaMsg'), /maior que o saldo/);
  await page.fill('#fBaixa [name=qtd]', '15');
  assert.match(await page.textContent('#baixaMsg'), /Saldo após a baixa: 3 lata/);
  await audit('modal-baixa');
  await page.click('#fBaixa [type=submit]');
  await page.waitForFunction(() => /3\s*lata/.test(document.querySelector('.stock-card')?.textContent + [...document.querySelectorAll('.stock-card')].map(c => c.textContent).join('')));
  assert.match(await page.locator('.stock-card', {hasText: 'Leite condensado'}).locator('.qty').textContent(), /3\s*lata/);

  // Reabrir o lote 2 deixaria o estoque negativo (as latas já foram usadas): o banco recusa.
  await go('#lote/2'); await page.waitForSelector('[data-act=reopen]');
  await page.click('[data-act=reopen]'); await okDialog();
  assert.match(await toastText(), /Não é possível reabrir/);

  // Editar produto: estoque mínimo faz o item aparecer em “Repor”.
  await go('#estoque'); await page.waitForSelector('.stock-card');
  await page.locator('.stock-card', {hasText: 'Leite condensado'}).locator('[data-editp]').click();
  await page.fill('#fProd [name=minimo]', '5'); await page.click('#fProd [type=submit]');
  await page.waitForTimeout(200);
  await page.click('.chip[data-f=alerta]');
  assert.match(await page.textContent('.stock-grid'), /Leite condensado/);
  assert.match(await page.textContent('[data-badge=estoque]'), /1/);

  await go('#mais'); await page.waitForSelector('#fUser'); await audit('mais');
  await page.fill('#fUser [name=email]', 'funcionaria@shakely.com'); await page.click('#fUser button');
  await page.waitForFunction(() => document.querySelector('.users')?.textContent.includes('funcionaria@shakely.com'));

  await go('#lote/1'); await page.waitForSelector('[data-act=repeat]');
  await page.click('[data-act=repeat]');
  await page.waitForFunction(() => location.hash === '#lote/novo' && document.querySelectorAll('.item-row').length === 2);
  assert.equal(await page.inputValue(`${row(1)} [data-f=produto]`), 'Leite condensado');

  // Tela de entrada.
  await page.evaluate(() => sessionStorage.setItem('fake-logged', '0')); await page.reload(); await page.waitForSelector('#authForm');
  await audit('login');
  await page.fill('[name=email]', 'teste@shakely.com'); await page.fill('[name=senha]', 'errada1'); await page.click('#authForm [type=submit]');
  await page.waitForFunction(() => /incorretos/.test(document.querySelector('.form-msg')?.textContent));

  await browser.close();
  const problems = Object.entries(audits).filter(([, v]) => v.length);
  if (problems.length) console.log(JSON.stringify(problems, null, 1));
  assert.equal(problems.length, 0, 'textos com contraste insuficiente');
  assert.deepEqual(errors, [], 'erros de JavaScript: ' + errors.join(' | '));
  console.log(`shakely app (${W}px): ok`);
})().catch(e => { console.error(e); process.exit(1); });
