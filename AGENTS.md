# Regras do projeto Shakely · Controle de Compras

- Publicar automaticamente: depois de concluir e testar qualquer alteração, fazer commit e `git push` no branch `main`, sem perguntar. Nunca afirmar que publicou sem a confirmação do GitHub (push aceito e GitHub Pages concluído).
- Banco: Supabase `wswsffgjegaamvykccbr` (shakely-compras). Mudanças de estrutura vão em `supabase/migrations/` e são aplicadas com migração. Nunca apagar dados sem pedido explícito.
- Segredos: só a chave **publicável** pode ficar no código (`js/config.js`). Nunca versionar senha, token, chave `service_role` ou `sb_secret_…`.
- Legibilidade (regra permanente): fundo escuro exige texto claro; fundo claro exige texto escuro. Contraste mínimo WCAG AA (4,5:1; 3:1 só para texto grande ou botão desativado). Fonte mínima de 11px para metadados e 12px para navegação. Nada sobreposto, cortado ou com rolagem horizontal.
- Celular e computador mostram as mesmas opções. Reorganizar é permitido; esconder não.
- Antes de publicar, rodar `node tests/util.test.mjs` e `tests/app.browser.cjs` em `W=390` e `W=1366`, com `python3 -m http.server 8091` aberto na raiz. Ao mudar regras do banco, atualizar também `tests/fake-api.js`.
- Ao mudar CSS ou JS, subir o `?v=` em `index.html` e o `CACHE` em `sw.js`.
