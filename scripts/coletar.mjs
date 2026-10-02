#!/usr/bin/env node
// Coleta: ClickUp → JSON do cliente.
//
//   node scripts/coletar.mjs sabrina            # lê a API (CLICKUP_TOKEN no .env)
//   node scripts/coletar.mjs sabrina --offline  # usa coleta/snapshots/ (sem rede)
//
// Etapas separadas: buscar tarefas (API ou snapshot) → transformar (config) → gravar data/<slug>.json.
// Números são copiados do campo como vieram. Campo vazio ou ilegível vira null. Nada é calculado.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_VERSION = 1;
const avisos = [];

async function lerJson(p) {
  return JSON.parse(await readFile(p, "utf8"));
}

async function carregarEnv() {
  const p = path.join(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const linha of (await readFile(p, "utf8")).split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// ---------- 1. Buscar ----------

async function buscarTarefaApi(taskId, token) {
  const url = `https://api.clickup.com/api/v2/task/${taskId}?include_subtasks=false&custom_task_ids=false`;
  const res = await fetch(url, { headers: { Authorization: token } });
  if (!res.ok) {
    const corpo = await res.text();
    const dica = res.status === 401 || res.status === 403
      ? " — verifique se o token tem acesso ao espaço dos Reports."
      : "";
    throw new Error(`ClickUp respondeu ${res.status} para a tarefa ${taskId}${dica}\n${corpo}`);
  }
  return res.json();
}

async function buscarTarefas(config, offline) {
  const dir = path.join(ROOT, "coleta", "snapshots");
  const tarefas = {};
  if (offline) {
    for (const area of config.areas) {
      tarefas[area.task_id] = await lerJson(path.join(dir, `${area.task_id}.json`));
    }
    return { tarefas, modo: "snapshot" };
  }
  const token = process.env.CLICKUP_TOKEN;
  if (!token) {
    throw new Error("CLICKUP_TOKEN não definido. Crie um .env (veja .env.example) ou use --offline.");
  }
  await mkdir(dir, { recursive: true });
  for (const area of config.areas) {
    const tarefa = await buscarTarefaApi(area.task_id, token);
    tarefas[area.task_id] = tarefa;
    // Snapshot bruto, para auditoria e para rodar offline. Não é publicado.
    await writeFile(path.join(dir, `${area.task_id}.json`), JSON.stringify(tarefa, null, 2) + "\n");
  }
  return { tarefas, modo: "api" };
}

// ---------- 2. Transformar ----------

function vazio(v) {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

function valorNumerico(campo, contexto) {
  if (!campo) {
    avisos.push(`${contexto}: campo não encontrado na tarefa → null`);
    return null;
  }
  if (vazio(campo.value)) return null;
  const n = typeof campo.value === "number" ? campo.value : Number(String(campo.value).trim());
  if (!Number.isFinite(n)) {
    avisos.push(`${contexto}: valor "${campo.value}" não é numérico → null`);
    return null;
  }
  return n;
}

function valorTexto(campo, contexto) {
  if (!campo) {
    avisos.push(`${contexto}: campo não encontrado na tarefa → null`);
    return null;
  }
  return vazio(campo.value) ? null : String(campo.value).trim();
}

function opcaoDropdown(campo) {
  if (!campo || vazio(campo.value)) return null;
  const opcoes = campo.type_config?.options ?? [];
  const op = opcoes.find((o) => o.orderindex === Number(campo.value) || o.id === campo.value);
  return op?.name ?? null;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function partes(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return { a, m, d };
}

function rotuloPeriodo({ inicio, fim }, longo = false) {
  const i = partes(inicio), f = partes(fim);
  const mes = (x) => (longo ? MESES_LONGOS : MESES)[x.m - 1];
  const sep = longo ? " de " : "/";
  if (inicio === fim) return `${i.d}${sep}${mes(i)}${sep}${i.a}`;
  if (i.m === f.m && i.a === f.a) return `${i.d} a ${f.d}${sep}${mes(f)}${sep}${f.a}`;
  return `${i.d}${sep}${mes(i)} a ${f.d}${sep}${mes(f)}${sep}${f.a}`;
}

function transformarArea(area, tarefa, config, textos) {
  const porId = new Map((tarefa.custom_fields ?? []).map((c) => [c.id, c]));

  const clienteNaTarefa = opcaoDropdown(porId.get(area.campo_cliente));
  if (clienteNaTarefa !== config.cliente.clickup_cliente) {
    avisos.push(`${area.id}: tarefa ${area.task_id} está marcada para cliente "${clienteNaTarefa}", esperado "${config.cliente.clickup_cliente}"`);
  }

  const diaUnico = area.periodo.inicio === area.periodo.fim;
  const semanaInteira = area.periodo.inicio === config.semana.inicio && area.periodo.fim === config.semana.fim;

  return {
    id: area.id,
    titulo: area.titulo,
    responsavel: area.responsavel,
    periodo: {
      inicio: area.periodo.inicio,
      fim: area.periodo.fim,
      rotulo: diaUnico ? `dados de ${rotuloPeriodo(area.periodo).replace(/\/\d{4}$/, "")}` : rotuloPeriodo(area.periodo),
      cobertura: semanaInteira ? "semana" : diaUnico ? "dia" : "parcial",
    },
    metricas: area.metricas.map((m) => ({
      id: m.id,
      rotulo: m.rotulo,
      valor: valorNumerico(porId.get(m.id), `${area.id} · ${m.campo}`),
      formato: m.formato,
      destaque: Boolean(m.destaque),
      grupo: m.grupo ?? null,
      anterior: null,
    })),
    textos: area.textos
      .filter((t) => t.exibir)
      .map((t) => ({ rotulo: t.rotulo, valor: valorTexto(porId.get(t.id), `${area.id} · ${t.campo}`) })),
    resumo: textos.areas?.[area.id] ?? null,
    fonte: {
      sistema: "ClickUp",
      task_id: area.task_id,
      atualizado_em: tarefa.date_updated ? new Date(Number(tarefa.date_updated)).toISOString() : null,
    },
  };
}

function transformar(config, textos, tarefas, modo) {
  return {
    schema_version: SCHEMA_VERSION,
    cliente: { nome: config.cliente.nome, slug: config.cliente.slug },
    periodo: {
      inicio: config.semana.inicio,
      fim: config.semana.fim,
      rotulo: rotuloPeriodo(config.semana, true),
    },
    demo: Boolean(config.demo),
    textos_exemplo: Boolean(textos.exemplo),
    destaques: textos.destaques ?? null,
    areas: config.areas.map((a) => transformarArea(a, tarefas[a.task_id], config, textos)),
    proximos_passos: textos.proximos_passos ?? [],
    // Reservado para a comparação com a semana anterior (a página já sabe esconder quando é null).
    comparacao_anterior: null,
    fonte: { sistema: "ClickUp", modo_coleta: modo, coletado_em: new Date().toISOString() },
  };
}

// ---------- 3. Gravar ----------

async function main() {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith("--")) ?? "sabrina";
  const offline = args.includes("--offline");
  await carregarEnv();

  const config = await lerJson(path.join(ROOT, "config", `${slug}.json`));
  const textosPath = path.join(ROOT, "content", `${slug}.json`);
  const textos = existsSync(textosPath) ? await lerJson(textosPath) : {};

  const { tarefas, modo } = await buscarTarefas(config, offline);
  const saida = transformar(config, textos, tarefas, modo);

  await mkdir(path.join(ROOT, "data"), { recursive: true });
  const destino = path.join(ROOT, "data", `${slug}.json`);
  await writeFile(destino, JSON.stringify(saida, null, 2) + "\n");

  console.log(`✓ ${path.relative(ROOT, destino)} gerado (${modo}, ${saida.areas.length} áreas)`);
  for (const a of saida.areas) {
    const preenchidas = a.metricas.filter((m) => m.valor !== null).length;
    console.log(`  · ${a.titulo} [${a.periodo.rotulo}]: ${preenchidas}/${a.metricas.length} métricas com valor`);
  }
  if (avisos.length) {
    console.log("\nAvisos:");
    for (const a of avisos) console.log(`  ! ${a}`);
  }
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
