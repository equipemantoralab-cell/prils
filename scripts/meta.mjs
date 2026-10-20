#!/usr/bin/env node
// Meta: Instagram + Meta Ads → resultados da semana do cliente.
//
//   node scripts/meta.mjs sabrina                      # semana passada (seg a dom)
//   node scripts/meta.mjs sabrina --inicio 2026-10-12
//   node scripts/meta.mjs sabrina --stories            # guarda os stories no ar agora (rodar 1x por dia)
//   node scripts/meta.mjs sabrina --offline            # refaz o JSON a partir do último snapshot
//
// Contas em config/meta.json; token em META_TOKEN (.env). Cada métrica é pedida separadamente:
// se uma falhar (permissão, conta pequena, métrica descontinuada), vira null + aviso e o resto segue.
// Stories só ficam na API por 24 h, por isso o modo --stories guarda em coleta/stories/<slug>/ e a
// coleta semanal soma o que foi guardado.

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TZ = "America/Sao_Paulo";
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

const dia = (ms) => new Date(Number(ms)).toLocaleDateString("sv-SE", { timeZone: TZ });
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const unix = (iso) => Math.floor(Date.parse(`${iso}T00:00:00-03:00`) / 1000);
function semanaPassada(hojeIso) {
  const dow = new Date(`${hojeIso}T12:00:00Z`).getUTCDay();
  return somarDias(somarDias(hojeIso, -((dow + 6) % 7)), -7);
}

// ---------- API ----------

let BASE = "https://graph.facebook.com/v23.0";
let TOKEN = "";

async function api(caminho, params = {}) {
  const qs = new URLSearchParams({ ...params, access_token: TOKEN });
  const res = await fetch(`${BASE}/${caminho}?${qs}`);
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok || corpo.error) {
    const e = corpo.error ?? {};
    const err = new Error(`${caminho}: ${e.message ?? res.status}`);
    err.code = e.code;
    throw err;
  }
  return corpo;
}

// Tenta e devolve null em caso de erro, anotando o motivo.
async function talvez(rotulo, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof TypeError) throw new Error(`Sem conexão com graph.facebook.com (${err.cause?.code ?? err.message}). Verifique a rede ou o proxy.`);
    if (err.code === 190) throw new Error(`Token da Meta inválido ou expirado (${err.message}). Gere outro e atualize META_TOKEN.`);
    avisos.push(`${rotulo}: ${err.message}`);
    return null;
  }
}

async function todasPaginas(caminho, params) {
  const itens = [];
  let r = await api(caminho, params);
  for (;;) {
    itens.push(...(r.data ?? []));
    if (!r.paging?.next) break;
    const res = await fetch(r.paging.next);
    r = await res.json();
    if (r.error) throw new Error(r.error.message);
  }
  return itens;
}

// ---------- Instagram ----------

const METRICAS_CONTA = ["reach", "views", "accounts_engaged", "total_interactions", "likes", "comments", "saves", "shares", "profile_links_taps"];
const METRICAS_POST = ["reach", "views", "likes", "comments", "saved", "shares", "total_interactions"];
const METRICAS_REELS = [...METRICAS_POST, "ig_reels_avg_watch_time"];
const METRICAS_STORY = ["reach", "views", "replies", "shares", "total_interactions", "navigation", "profile_visits", "follows"];

const valorTotal = (r) => r?.data?.[0]?.total_value?.value ?? null;

async function instagram(ig, inicio, fim) {
  const since = unix(inicio), until = unix(somarDias(fim, 1));
  const perfil = await talvez("perfil", () => api(ig, { fields: "username,name,followers_count,follows_count,media_count,profile_picture_url" }));

  const conta = {};
  for (const m of METRICAS_CONTA) {
    conta[m] = await talvez(`conta · ${m}`, async () =>
      valorTotal(await api(`${ig}/insights`, { metric: m, period: "day", metric_type: "total_value", since, until })));
  }

  // Seguir / deixar de seguir na semana
  const seg = await talvez("conta · follows_and_unfollows", () =>
    api(`${ig}/insights`, { metric: "follows_and_unfollows", period: "day", metric_type: "total_value", breakdown: "follow_type", since, until }));
  const resultadosSeg = seg?.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
  const pegar = (tipo) => resultadosSeg.find((x) => x.dimension_values?.[0] === tipo)?.value ?? null;
  conta.novos_seguidores = pegar("FOLLOWER");
  conta.deixaram_de_seguir = pegar("NON_FOLLOWER");

  // Público (contas com menos de 100 seguidores não têm esse dado)
  const publico = {};
  for (const b of ["age", "gender", "city"]) {
    publico[b] = await talvez(`público · ${b}`, async () => {
      const r = await api(`${ig}/insights`, { metric: "follower_demographics", period: "lifetime", metric_type: "total_value", breakdown: b });
      const res = r.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
      return res.map((x) => ({ rotulo: x.dimension_values[0], valor: x.value })).sort((a, z) => z.valor - a.valor);
    });
  }

  // Posts e Reels publicados na semana
  const midias = (await talvez("posts", () =>
    todasPaginas(`${ig}/media`, { fields: "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp", since, until, limit: "50" }))) ?? [];
  const posts = [];
  for (const md of midias) {
    const d = dia(Date.parse(md.timestamp));
    if (d < inicio || d > fim) continue;
    const reels = md.media_product_type === "REELS";
    const ins = {};
    for (const m of reels ? METRICAS_REELS : METRICAS_POST) {
      ins[m] = await talvez(`post ${md.id} · ${m}`, async () => (await api(`${md.id}/insights`, { metric: m })).data?.[0]?.values?.[0]?.value ?? null);
    }
    // A API devolve o tempo médio assistido em milissegundos.
    if (ins.ig_reels_avg_watch_time != null) ins.tempo_medio_assistido_s = Math.round(ins.ig_reels_avg_watch_time / 100) / 10;
    delete ins.ig_reels_avg_watch_time;
    posts.push({
      id: md.id,
      formato: reels ? "Reels" : md.media_type === "CAROUSEL_ALBUM" ? "Carrossel" : md.media_type === "VIDEO" ? "Vídeo" : "Imagem",
      data: d,
      legenda: (md.caption ?? "").split("\n")[0].slice(0, 140),
      link: md.permalink,
      imagem: md.thumbnail_url ?? md.media_url ?? null,
      ...ins,
    });
  }

  return { perfil, conta, publico, posts };
}

async function storiesAgora(ig) {
  const lista = (await talvez("stories", () => todasPaginas(`${ig}/stories`, { fields: "id,media_type,permalink,thumbnail_url,media_url,timestamp" }))) ?? [];
  const saida = [];
  for (const s of lista) {
    const ins = {};
    for (const m of METRICAS_STORY) {
      ins[m] = await talvez(`story ${s.id} · ${m}`, async () => (await api(`${s.id}/insights`, { metric: m })).data?.[0]?.values?.[0]?.value ?? null);
    }
    saida.push({ id: s.id, data: dia(Date.parse(s.timestamp)), tipo: s.media_type, link: s.permalink, imagem: s.thumbnail_url ?? s.media_url ?? null, ...ins });
  }
  return saida;
}

async function storiesGuardados(slug, inicio, fim) {
  const dir = path.join(ROOT, "coleta", "stories", slug);
  if (!existsSync(dir)) return [];
  const porId = new Map();
  for (const f of (await readdir(dir)).filter((x) => x.endsWith(".json")).sort()) {
    for (const s of await lerJson(path.join(dir, f))) porId.set(s.id, s); // a leitura mais recente vence
  }
  return [...porId.values()].filter((s) => s.data >= inicio && s.data <= fim);
}

// ---------- Meta Ads ----------

const CAMPOS_ADS = "spend,impressions,reach,frequency,cpm,ctr,cpc,clicks,inline_link_clicks,actions,cost_per_action_type";
const ACOES = { lead: "leads", purchase: "compras", "onsite_conversion.messaging_conversation_started_7d": "conversas", video_view: "visualizacoes_video", like: "curtidas_pagina" };

function resumirAcoes(linha) {
  const out = {};
  for (const a of linha.actions ?? []) if (ACOES[a.action_type]) out[ACOES[a.action_type]] = Number(a.value);
  for (const a of linha.cost_per_action_type ?? []) if (ACOES[a.action_type]) out[`custo_${ACOES[a.action_type]}`] = Number(a.value);
  return out;
}
const num = (v) => (v === undefined || v === null ? null : Number(v));

async function anuncios(contas, inicio, fim) {
  const time_range = JSON.stringify({ since: inicio, until: fim });
  const total = { investimento: 0, impressoes: 0, alcance_somado: 0, cliques: 0 };
  const campanhas = [];
  const porConta = [];
  for (const act of contas) {
    const r = await talvez(`ads ${act}`, () => api(`${act}/insights`, { fields: CAMPOS_ADS, time_range, level: "account" }));
    const l = r?.data?.[0];
    if (l) {
      porConta.push({ conta: act, investimento: num(l.spend), impressoes: num(l.impressions), alcance: num(l.reach), cpm: num(l.cpm), ctr: num(l.ctr), cpc: num(l.cpc), ...resumirAcoes(l) });
      total.investimento += num(l.spend) ?? 0;
      total.impressoes += num(l.impressions) ?? 0;
      total.alcance_somado += num(l.reach) ?? 0;
      total.cliques += num(l.inline_link_clicks) ?? 0;
    }
    const c = await talvez(`ads ${act} · campanhas`, () =>
      todasPaginas(`${act}/insights`, { fields: `campaign_name,objective,${CAMPOS_ADS}`, time_range, level: "campaign", limit: "100" }));
    for (const x of c ?? []) {
      campanhas.push({ conta: act, nome: x.campaign_name, objetivo: x.objective ?? null, investimento: num(x.spend), alcance: num(x.reach), cpm: num(x.cpm), ctr: num(x.ctr), cpc: num(x.cpc), ...resumirAcoes(x) });
    }
  }
  campanhas.sort((a, z) => (z.investimento ?? 0) - (a.investimento ?? 0));
  const temDados = porConta.length > 0;
  return {
    total: temDados ? {
      investimento: Math.round(total.investimento * 100) / 100,
      impressoes: total.impressoes,
      cpm: total.impressoes ? Math.round((total.investimento / total.impressoes) * 100000) / 100 : null,
      ctr_link: total.impressoes ? Math.round((total.cliques / total.impressoes) * 10000) / 100 : null,
      cliques_link: total.cliques,
    } : null,
    por_conta: porConta,
    campanhas,
  };
}

// ---------- Montagem ----------

function destaquesPosts(posts) {
  const top = (campo) => [...posts].filter((p) => p[campo] != null).sort((a, z) => z[campo] - a[campo])[0] ?? null;
  return { maior_alcance: top("reach")?.id ?? null, mais_salvo: top("saved")?.id ?? null, mais_comentado: top("comments")?.id ?? null };
}

function media(lista, campo) {
  const v = lista.map((x) => x[campo]).filter((x) => typeof x === "number");
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

function montar(cli, slug, inicio, fim, bruto) {
  const { ig, ads, stories } = bruto;
  const posts = ig?.posts ?? [];
  const feed = posts.filter((p) => p.formato !== "Reels");
  return {
    schema_version: 1,
    cliente: { nome: cli.nome, slug },
    periodo: { inicio, fim },
    instagram: ig ? {
      usuario: ig.perfil?.username ?? cli.usuario,
      seguidores: ig.perfil?.followers_count ?? null,
      conta: ig.conta,
      publico: ig.publico,
      publicacoes: { total: posts.length, reels: posts.length - feed.length, feed: feed.length, stories: stories.length },
      medias: { alcance_feed: media(feed, "reach"), alcance_reels: media(posts.filter((p) => p.formato === "Reels"), "reach"), visualizacoes_stories: media(stories, "views") },
      destaques: destaquesPosts(posts),
      posts,
      stories,
    } : null,
    anuncios: ads,
    fonte: { sistema: "Meta", coletado_em: new Date().toISOString() },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--inicio") ?? "sabrina";
  const iArg = args.indexOf("--inicio");
  await carregarEnv();

  const cfg = await lerJson(path.join(ROOT, "config", "meta.json"));
  const cli = cfg.clientes[slug];
  if (!cli) throw new Error(`Cliente "${slug}" não está em config/meta.json.`);
  if (cli.confirmar) avisos.push(`IDs de ${cli.nome} ainda marcados para confirmar em config/meta.json`);
  BASE = `https://graph.facebook.com/${cfg.versao_api ?? "v23.0"}`;

  const snapDir = path.join(ROOT, "coleta", "snapshots");
  const snap = path.join(snapDir, `meta-${slug}.json`);

  if (args.includes("--offline")) {
    const s = await lerJson(snap);
    const saida = montar(cli, slug, s.inicio, s.fim, s);
    await gravar(slug, saida, "snapshot");
    return;
  }

  TOKEN = process.env.META_TOKEN;
  if (!TOKEN) throw new Error("META_TOKEN não definido no .env.");

  if (args.includes("--stories")) {
    if (!cli.ig) throw new Error(`${cli.nome} não tem Instagram configurado.`);
    const lista = await storiesAgora(cli.ig);
    const dir = path.join(ROOT, "coleta", "stories", slug);
    await mkdir(dir, { recursive: true });
    const arq = path.join(dir, `${new Date().toISOString().slice(0, 13).replace("T", "_")}h.json`);
    await writeFile(arq, JSON.stringify(lista, null, 2) + "\n");
    console.log(`✓ ${lista.length} stories guardados em ${path.relative(ROOT, arq)}`);
    for (const a of avisos) console.log(`  ! ${a}`);
    return;
  }

  const inicio = iArg >= 0 ? args[iArg + 1] : semanaPassada(dia(Date.now()));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) throw new Error(`--inicio inválido: ${inicio}`);
  const fim = somarDias(inicio, 6);

  const ig = cli.ig ? await instagram(cli.ig, inicio, fim) : null;
  const ads = cli.ads?.length ? await anuncios(cli.ads, inicio, fim) : null;
  const stories = await storiesGuardados(slug, inicio, fim);
  if (cli.ig && !stories.length) avisos.push("nenhum story guardado na semana: agende `--stories` diariamente para ter esses números");

  await mkdir(snapDir, { recursive: true });
  await writeFile(snap, JSON.stringify({ inicio, fim, ig, ads, stories }, null, 2) + "\n");
  await gravar(slug, montar(cli, slug, inicio, fim, { ig, ads, stories }), "api");
}

async function gravar(slug, saida, modo) {
  await mkdir(path.join(ROOT, "data"), { recursive: true });
  const destino = path.join(ROOT, "data", `${slug}-meta.json`);
  await writeFile(destino, JSON.stringify(saida, null, 2) + "\n");
  // Histórico: uma cópia por semana, usada para comparar com as semanas anteriores.
  const hist = path.join(ROOT, "data", "historico", slug);
  await mkdir(hist, { recursive: true });
  await writeFile(path.join(hist, `meta-${saida.periodo.inicio}.json`), JSON.stringify(saida, null, 2) + "\n");
  const i = saida.instagram, a = saida.anuncios?.total;
  console.log(`✓ ${path.relative(ROOT, destino)} · ${saida.periodo.inicio} a ${saida.periodo.fim} (${modo})`);
  if (i) console.log(`  Instagram @${i.usuario}: alcance ${i.conta?.reach ?? "—"}, interações ${i.conta?.total_interactions ?? "—"}, ${i.publicacoes.total} posts, ${i.publicacoes.stories} stories`);
  if (a) console.log(`  Anúncios: R$ ${a.investimento} investidos, CPM ${a.cpm ?? "—"}, CTR ${a.ctr_link ?? "—"}%`);
  for (const x of [...new Set(avisos)]) console.log(`  ! ${x}`);
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
