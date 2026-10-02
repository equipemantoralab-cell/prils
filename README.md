# Relatório semanal do cliente · Mantora Lab (protótipo)

Página que cada cliente recebe com o resumo da semana. Três etapas independentes:

```
ClickUp (Reports das líderes) ──coleta──▶ data/<cliente>.json ──render──▶ index.html
```

A página depende **só do formato do JSON**, não do ClickUp. Para trocar por Supabase, basta servir o mesmo formato.

## Estrutura

| Caminho | O que é |
|---|---|
| `config/<cliente>.json` | Mapeamento: qual tarefa do ClickUp é qual área, quais campos (por ID) aparecem, rótulo e formato. Só o que está aqui vai para o JSON público. |
| `content/<cliente>.json` | Textos para o cliente: destaques, resumo por área, próximos passos. Fica separado para a coleta não sobrescrever. |
| `scripts/coletar.mjs` | Coleta (Node 18+, sem dependências). Copia os valores dos campos sem calcular nada. Campo vazio vira `null`. |
| `coleta/snapshots/` | Retorno bruto do ClickUp (auditoria e modo offline). **Não é publicado.** |
| `data/<cliente>.json` | Saída pública consumida pela página. |
| `index.html` | Página estática (CSS/JS inline). `?cliente=<slug>` escolhe o JSON. |

## Rodar localmente

```bash
cp .env.example .env              # coloque seu CLICKUP_TOKEN
npm run coletar                   # lê a API e gera data/sabrina.json
# ou, sem token: npm run coletar:offline  (usa coleta/snapshots/)
npm run dev                       # http://localhost:8000
```

Abrir `index.html` direto (file://) não funciona porque o navegador bloqueia o `fetch` do JSON. Use o servidor local.

## Formato do JSON (schema_version 1)

- `cliente {nome, slug}`, `periodo {inicio, fim, rotulo}`, `destaques`, `proximos_passos[]`
- `areas[]`: `{id, titulo, responsavel, periodo {inicio, fim, rotulo, cobertura: semana|dia|parcial}, metricas[], textos[], resumo, fonte}`
- `metricas[]`: `{rotulo, valor (número ou null), formato: numero|moeda|percentual|multiplicador, destaque, grupo, anterior}`
- `anterior` e `comparacao_anterior` já estão reservados para a comparação com a semana anterior. A página mostra esse bloco só quando houver valor.
- `demo` / `textos_exemplo` exibem o aviso de "dados de demonstração".

## Deploy

`netlify.toml` e `vercel.json` publicam só `index.html` + `data/` (pasta `dist/`). A página tem `noindex`.
