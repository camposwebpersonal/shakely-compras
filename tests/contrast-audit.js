// Auditoria de contraste (WCAG) executada dentro da página: encontra textos visíveis cujo
// contraste com o fundo efetivo é menor que 4,5:1 (texto normal) ou 3:1 (texto grande).
window.__contrastAudit = function (scope = document.body) {
  const parse = s => {
    const c = String(s).match(/color\(srgb ([^)]+)\)/);
    if (c) { const p = c[1].split(/[ /]+/).filter(Boolean).map(Number); return {r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1}; }
    const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return {r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1};
  };
  const blend = (top, bot) => ({r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1});
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const gradColors = img => (img.match(/rgba?\([^)]+\)|color\(srgb [^)]+\)/g) || []).map(parse).filter(Boolean);
  // Fundo efetivo: compõe as camadas de baixo para cima; gradientes viram a lista de cores possíveis.
  function backgrounds(el) {
    const chain = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.push(n);
    let layers = [[{r: 255, g: 255, b: 255, a: 1}]];
    for (const n of chain.reverse()) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage.includes('url(') && !cs.backgroundImage.includes('gradient')) return null; // foto: não avalia
      const g = cs.backgroundImage.includes('gradient') ? gradColors(cs.backgroundImage) : [];
      const bg = parse(cs.backgroundColor);
      let next = layers[0];
      if (bg && bg.a > 0) next = next.map(base => blend(bg, base));
      if (g.length) next = g.flatMap(gc => next.map(base => blend(gc, base)));
      layers = [next.slice(0, 12)];
    }
    return layers[0];
  }
  const issues = [], seen = new Set();
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {acceptNode: t => t.textContent.trim().length > 1 ? 1 : 2});
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
    if (el.closest('script,style,noscript,svg,option,.leaflet-container,[hidden],[aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible' || +cs.opacity < .2) continue;
    let hiddenAnc = false; for (let n = el; n; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || +s.opacity < .2) { hiddenAnc = true; break; } } if (hiddenAnc) continue;
    const disabled = !!el.closest('button:disabled,[disabled]');
    const fg = parse(cs.color); if (!fg) continue;
    const bgs = backgrounds(el); if (!bgs) continue;
    const worst = Math.min(...bgs.map(bg => ratio(fg.a < 1 ? blend(fg, bg) : fg, bg)));
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
    const need = disabled ? 3 : (size >= 24 || (bold && size >= 18.66)) ? 3 : 4.5;
    if (worst < need) {
      const path = []; for (let n = el; n && n !== document.body && path.length < 4; n = n.parentElement) path.unshift(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.classList.length ? '.' + [...n.classList].slice(0, 2).join('.') : ''));
      issues.push({ratio: +worst.toFixed(2), need, text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 50), color: cs.color, bg: `rgb(${Math.round(bgs[0].r)},${Math.round(bgs[0].g)},${Math.round(bgs[0].b)})`, path: path.join(' > ')});
    }
  }
  // Campos de digitação: texto digitado e texto de exemplo (placeholder) também precisam ser legíveis.
  for (const el of scope.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=hidden]),textarea,select')) {
    if (el.closest('[hidden],.leaflet-container')) continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    let hiddenAnc = false; for (let n = el; n; n = n.parentElement) { const st = getComputedStyle(n); if (st.display === 'none' || st.visibility === 'hidden' || +st.opacity < .2) { hiddenAnc = true; break; } } if (hiddenAnc) continue;
    const bgs = backgrounds(el); if (!bgs) continue;
    const checks = [['texto', getComputedStyle(el).color, 4.5]];
    if (el.placeholder) checks.push(['exemplo', getComputedStyle(el, '::placeholder').color, 3]);
    for (const [kind, color, need] of checks) {
      const fg = parse(color); if (!fg) continue;
      const worst = Math.min(...bgs.map(bg => ratio(fg.a < 1 ? blend(fg, bg) : fg, bg)));
      if (worst < need) issues.push({ratio: +worst.toFixed(2), need, text: '[campo ' + kind + '] ' + (el.placeholder || el.name || el.id || el.tagName).slice(0, 40), color, bg: `rgb(${Math.round(bgs[0].r)},${Math.round(bgs[0].g)},${Math.round(bgs[0].b)})`, path: (el.parentElement?.className ? el.parentElement.tagName.toLowerCase() + '.' + String(el.parentElement.className).split(' ')[0] + ' > ' : '') + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '')});
    }
  }
  return issues;
};
