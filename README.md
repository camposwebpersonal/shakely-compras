# Shakely · Controle de Compras

Sistema web da sorveteria **Shakely** para registrar compras por **lote**, pesquisar o **último preço pago** de cada item e acompanhar o **estoque** calculado a partir das compras confirmadas.

**Site:** https://camposwebpersonal.github.io/shakely-compras/

## Como funciona

- **Lotes de compra.** Cada lote recebe um número automático e sequencial (Nº 0001, 0002…). Um número nunca é reaproveitado, nem quando um lote é excluído.
- **Itens do lote.** Cada item tem: Item, Loja (fornecedor), Data da compra, Quantidade, Valor unitário e Valor total. O unitário e o total se calculam um pelo outro.
- **Rascunho → Confirmado.**
  - Enquanto o lote está em rascunho, ele pode ser editado à vontade.
  - Ao confirmar, os itens entram no estoque e o lote fica travado.
  - Para corrigir um lote confirmado, é preciso reabri-lo. O banco não deixa reabrir se as unidades daquele lote já foram baixadas do estoque.
- **Pesquisa de preços.** Mostra para cada item:
  - o último preço confirmado, com loja e data;
  - a variação em relação à compra anterior;
  - o menor e o maior preço já pagos e o preço médio;
  - o último preço em cada loja;
  - o gráfico da evolução do preço e o histórico completo.
- **Estoque.** O saldo é a soma das compras confirmadas menos as baixas (uso, venda, perda, ajuste). Mostra também o estoque mínimo, o custo médio e o valor em estoque. O banco recusa uma baixa que deixaria o saldo negativo.
- **Acesso.**
  - A entrada é por e-mail e senha.
  - Só e-mails da lista **Usuários autorizados** leem ou gravam dados. Essa regra está no banco (RLS), não apenas na tela.
  - A lista é editada pelo próprio sistema, em Mais.

## Estrutura

| Caminho | Conteúdo |
|---|---|
| `index.html`, `css/styles.css` | página e visual (cores da marca, fundo claro e texto escuro) |
| `js/app.js` | telas e regras de uso |
| `js/util.js` | contas puras: números em formato brasileiro, preços e estoque |
| `js/api.js`, `js/config.js` | acesso ao Supabase (chave **publicável**, feita para ficar no navegador) |
| `supabase/migrations/` | tabelas, regras (gatilhos), visões e RLS |
| `tests/` | testes das contas e teste de ponta a ponta com banco simulado |

## Testes

Os comandos abaixo rodam a partir da raiz do projeto:

```bash
node tests/util.test.mjs
python3 -m http.server 8091 &
NODE_PATH=$(npm root -g) W=390 node tests/app.browser.cjs
NODE_PATH=$(npm root -g) W=1366 node tests/app.browser.cjs
```

O teste de navegador usa um banco simulado (`tests/fake-api.js`) com as mesmas regras do banco real. Ele também verifica:

- o contraste dos textos (WCAG AA);
- que nenhuma tela tenha rolagem horizontal.

## Banco de dados

- **Projeto Supabase:** `shakely-compras` (`wswsffgjegaamvykccbr`, região São Paulo).
- **Tabelas:**
  - `lotes`: o número é a chave, gerado automaticamente;
  - `compras`: os itens do lote;
  - `produtos`;
  - `fornecedores`;
  - `saidas`: as baixas de estoque;
  - `usuarios_autorizados`.
- **Visões:** `v_lotes`, `v_compras` e `v_estoque`.
