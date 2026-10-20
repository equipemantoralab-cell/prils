#!/usr/bin/env node
// Atividades: tarefas do ClickUp → resumo da semana do cliente, sem formulário.
//
//   node scripts/atividades.mjs sabrina                      # semana passada (seg a dom), via API
//   node scripts/atividades.mjs sabrina --inicio 2026-10-12  # semana que começa nessa segunda
//   node scripts/atividades.mjs sabrina --offline            # usa coleta/snapshots/atividades-<slug>.json
//
// O que entra:
//   · status atual de cada tarefa das listas do cliente (config.atividades)
//   · entregues = status do tipo "done"/"closed" com data de entrega dentro da semana
//   · relato manual = comentário com o marcador (ex.: #relatorio) ou tarefa com a etiqueta (ex.: relatorio)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TZ = "America/Sao_Paulo";
const API = "https://api.clickup.com/api/v2";
const JANELA_DIAS = 45; // tarefas sem atualização há mais tempo que isso ficam de fora
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

// ---------- datas (dia no fuso de São Paulo) ----------

const dia = (ms) => (ms ? new Date(Number(ms)).toLocaleDateString("sv-SE", { timeZone: TZ }) : null);
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const inicioMs = (iso) => Date.parse(`${iso}T00:00:00-03:00`);

function semanaPassada(hojeIso) {
  const dow = new Date(`${hojeIso}T12:00:00Z`).getUTCDay(); // 0 = domingo
  const segundaAtual = somarDias(hojeIso, -((dow + 6) % 7));
  return somarDias(segundaAtual, -7);
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function rotulo(inicio, fim) {
  const [, mi, di] = inicio.split("-").map(Number);
  const [af, mf, df] = fim.split("-").map(Number);
  return mi === mf ? `${di} a ${df}/${MESES[mf - 1]}/${af}` : `${di}/${MESES[mi - 1]} a ${df}/${MESES[mf - 1]}/${af}`;
}

// ---------- 1. Buscar ----------

async function get(url, token) {
  const res = await fetch(url, { headers: { Authorization: token } });
  if (!res.ok) {
    const dica = res.status === 401 || res.status === 403 ? " — verifique se o token enxerga as listas do cliente." : "";
    throw new Error(`ClickUp respondeu ${res.status} em ${url}${dica}\n${await res.text()}`);
  }
  return res.json();
}

async function buscarApi(config, cfg, inicio, token) {
  const params = new URLSearchParams({
    include_closed: "true",
    subtasks: "true",
    order_by: "updated",
    date_updated_gt: String(inicioMs(somarDias(inicio, -JANELA_DIAS))),
  });
  for (const l of cfg.listas) params.append("list_ids[]", l.id);
  for (const p of cfg.pastas ?? []) params.append("project_ids[]", p);

  const tarefas = [];
  for (let page = 0; ; page++) {
    params.set("page", String(page));
    const r = await get(`${API}/team/${config.workspace_id}/task?${params}`, token);
    tarefas.push(...r.tasks);
    if (r.last_page !== false || r.tasks.length === 0) break;
  }

  // Comentários só das tarefas mexidas na semana (onde um relato pode ter sido escrito).
  const fimMs = inicioMs(somarDias(inicio, 7));
  const comentarios = {};
  for (const t of tarefas) {
    if (Number(t.date_updated) < inicioMs(inicio)) continue;
    const r = await get(`${API}/task/${t.id}/comment`, token);
    const doPeriodo = r.comments.filter((c) => Number(c.date) >= inicioMs(inicio) && Number(c.date) < fimMs);
    if (doPeriodo.length) comentarios[t.id] = doPeriodo;
  }
  return { tarefas, comentarios };
}

// ---------- 2. Classificar ----------

// Fase a partir do status. Os nomes vêm das listas do ClickUp da Mantora; o tipo do status decide entregue.
function fase(status) {
  const nome = (status?.status ?? "").toLowerCase();
  const tipo = status?.type;
  if (tipo === "done" || tipo === "closed") return "entregue";
  if (nome === "stand by") return "pausado";
  if (tipo === "open" || nome === "pendente") return "a_fazer";
  if (/aprovad|programad/.test(nome)) return "aprovado";
  return "em_producao";
}

const FORMATOS = [
  [/\breels?\b|\btake\b|\breact\b|v[íi]deo/i, "Reels"],
  [/carrossel/i, "Carrossel"],
  [/\bcapa\b/i, "Capa"],
  [/imagem/i, "Imagem"],
];

function limparNome(nome, prefixo) {
  let n = nome.replace(/\s+/g, " ").trim();
  if (prefixo) n = n.replace(new RegExp(`^${prefixo}\\s*[-|]?\\s*`, "i"), "");
  // "Reels | Título" → "Título"; mantém nomes sem barra.
  const i = n.indexOf("|");
  let titulo = i >= 0 ? n.slice(i + 1).trim() : n;
  const antes = i >= 0 ? n.slice(0, i) : n;
  let formato = FORMATOS.find(([re]) => re.test(antes))?.[1] ?? null;
  // "editar o vídeo "Frase"" (lista de edição) → Reels + a frase
  const ed = titulo.match(/^editar (?:o )?v[íi]deo\s*(.*)$/i);
  if (ed) { titulo = ed[1]; formato = "Reels"; }
  return { titulo: titulo.replace(/^["“]|["”]$/g, "") || n, formato };
}

function dataEntrega(t) {
  // REST traz date_done (status "done") e date_closed ("closed"). Sem nenhum dos dois, usa o prazo.
  return dia(t.date_done) ?? dia(t.date_closed) ?? dia(t.due_date) ?? dia(t.date_updated);
}

function textoComentario(c) {
  if (c.comment_text) return c.comment_text;
  return (c.comment ?? []).map((p) => p.text ?? "").join("");
}

function transformar(config, cfg, bruto, inicio, modo) {
  const fim = somarDias(inicio, 6);
  const proxFim = somarDias(fim, 7);
  const porLista = new Map(cfg.listas.map((l) => [l.id, l]));
  const marcador = (cfg.marcador_comentario ?? "#relatorio").toLowerCase();
  const etiqueta = (cfg.etiqueta_destaque ?? "relatorio").toLowerCase();

  const itens = bruto.tarefas
    .filter((t) => !t.archived)
    .map((t) => {
      const lista = porLista.get(t.list?.id);
      if (!lista) avisos.push(`lista "${t.list?.name}" (${t.list?.id}) não está no config → área = nome da lista`);
      const { titulo, formato } = limparNome(t.name, cfg.prefixo_nome);
      const f = fase(t.status);
      return {
        id: t.id,
        titulo,
        formato,
        area: lista?.area ?? (t.list?.name ?? "Outros").trim(),
        conta_como: lista?.conta_como ?? "projeto",
        status: t.status?.status ?? null,
        fase: f,
        em_ajuste: /altera/i.test(t.status?.status ?? ""),
        responsaveis: (t.assignees ?? []).map((a) => a.username.split(" ")[0]),
        prazo: dia(t.due_date),
        entregue_em: f === "entregue" ? dataEntrega(t) : null,
        destaque: (t.tags ?? []).some((g) => g.name?.toLowerCase() === etiqueta),
        url: t.url,
      };
    });

  const naSemana = (d) => d && d >= inicio && d <= fim;
  const entregues = itens.filter((i) => i.fase === "entregue" && naSemana(i.entregue_em));
  const proximos = itens.filter((i) => i.fase === "a_fazer" && i.prazo && i.prazo > fim && i.prazo <= proxFim);
  // Pendências com o próprio cliente como responsável (gravar, aprovar, mandar material).
  const nomeCliente = config.cliente.nome.split(" ")[0];
  const doCliente = (i) => i.responsaveis.includes(nomeCliente);
  const andamento = itens.filter((i) => !doCliente(i) && (i.fase === "em_producao" || i.fase === "aprovado"));
  const aguardandoCliente = itens.filter((i) => doCliente(i) && i.fase !== "entregue" && i.fase !== "pausado");
  // Uso interno do time: não aparece na página do cliente.
  const atrasados = itens.filter((i) => !doCliente(i) && i.fase !== "entregue" && i.fase !== "pausado" && i.prazo && i.prazo <= fim);

  // Relato manual
  const nomePorId = new Map(itens.map((i) => [i.id, i]));
  const notas = [];
  for (const [taskId, lista] of Object.entries(bruto.comentarios ?? {})) {
    for (const c of lista) {
      const texto = textoComentario(c);
      if (!texto.toLowerCase().includes(marcador)) continue;
      notas.push({
        texto: texto.replace(new RegExp(marcador.replace("#", "#?"), "ig"), "").trim(),
        autor: c.user?.username?.split(" ")[0] ?? null,
        data: dia(c.date),
        tarefa: nomePorId.get(taskId)?.titulo ?? null,
        url: nomePorId.get(taskId)?.url ?? null,
      });
    }
  }
  for (const i of itens.filter((x) => x.destaque && (naSemana(x.entregue_em) || x.fase !== "entregue"))) {
    notas.push({ texto: null, autor: null, data: i.entregue_em, tarefa: i.titulo, url: i.url, por_etiqueta: true });
  }
  notas.sort((a, b) => (b.data ?? "").localeCompare(a.data ?? ""));

  const contar = (arr, chave) => arr.reduce((m, i) => ((m[i[chave] ?? "Outro"] = (m[i[chave] ?? "Outro"] ?? 0) + 1), m), {});
  const ordenar = (arr, campo) => [...arr].sort((a, b) => (a[campo] ?? "9").localeCompare(b[campo] ?? "9"));

  return {
    schema_version: 1,
    cliente: { nome: config.cliente.nome, slug: config.cliente.slug },
    periodo: { inicio, fim, rotulo: rotulo(inicio, fim) },
    resumo: {
      publicados: entregues.filter((i) => i.conta_como === "publicacao").length,
      pecas: entregues.filter((i) => i.conta_como === "peca").length,
      projetos: entregues.filter((i) => i.conta_como === "projeto").length,
      entregues: entregues.length,
      em_andamento: andamento.length,
      em_ajuste: andamento.filter((i) => i.em_ajuste).length,
      aprovados: andamento.filter((i) => i.fase === "aprovado").length,
      proximos: proximos.length,
      aguardando_cliente: aguardandoCliente.length,
      atrasados: atrasados.length,
    },
    entregues_por_area: contar(entregues, "area"),
    entregues_por_formato: contar(entregues.filter((i) => i.conta_como === "publicacao"), "formato"),
    entregues: ordenar(entregues, "entregue_em"),
    em_andamento: ordenar(andamento, "prazo"),
    proximos: ordenar(proximos, "prazo"),
    aguardando_cliente: ordenar(aguardandoCliente, "prazo"),
    atrasados: ordenar(atrasados, "prazo"),
    notas,
    fonte: { sistema: "ClickUp", modo_coleta: modo, coletado_em: new Date().toISOString(), tarefas_lidas: bruto.tarefas.length },
  };
}

// ---------- 3. Gravar ----------

async function main() {
  const args = process.argv.slice(2);
  const slug = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--inicio") ?? "sabrina";
  const offline = args.includes("--offline");
  const iArg = args.indexOf("--inicio");
  await carregarEnv();

  const config = await lerJson(path.join(ROOT, "config", `${slug}.json`));
  const cfg = config.atividades;
  if (!cfg) throw new Error(`config/${slug}.json não tem o bloco "atividades".`);

  const snap = path.join(ROOT, "coleta", "snapshots", `atividades-${slug}.json`);
  let bruto, modo, inicio;
  if (offline) {
    bruto = await lerJson(snap);
    modo = "snapshot";
    inicio = iArg >= 0 ? args[iArg + 1] : bruto.semana_inicio ?? semanaPassada(dia(Date.now()));
  } else {
    const token = process.env.CLICKUP_TOKEN;
    if (!token) throw new Error("CLICKUP_TOKEN não definido. Crie um .env (veja .env.example) ou use --offline.");
    inicio = iArg >= 0 ? args[iArg + 1] : semanaPassada(dia(Date.now()));
    bruto = await buscarApi(config, cfg, inicio, token);
    modo = "api";
    await mkdir(path.dirname(snap), { recursive: true });
    await writeFile(snap, JSON.stringify({ semana_inicio: inicio, ...bruto }, null, 2) + "\n");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) throw new Error(`--inicio inválido: ${inicio} (use AAAA-MM-DD)`);

  const saida = transformar(config, cfg, bruto, inicio, modo);
  await mkdir(path.join(ROOT, "data"), { recursive: true });
  const destino = path.join(ROOT, "data", `${slug}-atividades.json`);
  await writeFile(destino, JSON.stringify(saida, null, 2) + "\n");

  const r = saida.resumo;
  console.log(`✓ ${path.relative(ROOT, destino)} · ${saida.periodo.rotulo} (${modo}, ${saida.fonte.tarefas_lidas} tarefas lidas)`);
  console.log(`  entregues ${r.entregues} (publicações ${r.publicados}, peças ${r.pecas}, projetos ${r.projetos})`);
  console.log(`  em andamento ${r.em_andamento} (${r.em_ajuste} em ajuste) · próximos 7 dias ${r.proximos} · com o cliente ${r.aguardando_cliente} · atrasados (interno) ${r.atrasados} · notas ${saida.notas.length}`);
  for (const a of [...new Set(avisos)]) console.log(`  ! ${a}`);
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
