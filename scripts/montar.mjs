#!/usr/bin/env node
// Monta o relatório semanal do cliente juntando as fontes já coletadas:
//
//   data/<slug>-atividades.json           (scripts/atividades.mjs · ClickUp)
//   data/historico/<slug>/meta-*.json     (scripts/meta.mjs · Instagram + Meta Ads)
//   content/<slug>-semana.json            (textos revisados pelo time: destaques, marcos, próximos passos)
//
//   node scripts/montar.mjs sabrina                      # semana das atividades
//   node scripts/montar.mjs sabrina --inicio 2026-10-12
//
// Saída: data/<slug>-relatorio.json (o que relatorio.html lê) e as miniaturas dos posts em data/midia/<slug>/,
// porque os links de imagem da Meta expiram em poucos dias.

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const avisos = [];
const lerJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const talvezJson = async (p) => (existsSync(p) ? lerJson(p) : null);

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
function rotulo(inicio, fim) {
  const [, mi, di] = inicio.split("-").map(Number);
  const [af, mf, df] = fim.split("-").map(Number);
  return mi === mf ? `${di} a ${df} de ${MESES[mf - 1]} de ${af}` : `${di} de ${MESES[mi - 1]} a ${df} de ${MESES[mf - 1]} de ${af}`;
}

// Resumo de uma semana da Meta, para o histórico e as comparações.
function resumoSemana(m) {
  const c = m.instagram?.conta ?? {};
  return {
    inicio: m.periodo.inicio,
    alcance: c.reach ?? null,
    visualizacoes: c.views ?? null,
    interacoes: c.total_interactions ?? null,
    contas_engajadas: c.accounts_engaged ?? null,
    novos_seguidores: c.novos_seguidores ?? null,
    deixaram_de_seguir: c.deixaram_de_seguir ?? null,
    publicacoes: m.instagram?.publicacoes?.total ?? null,
    investimento: m.anuncios?.total?.investimento ?? null,
  };
}

function mediaDe(semanas, campo) {
  const v = semanas.map((s) => s[campo]).filter((x) => typeof x === "number");
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

async function baixarMiniatura(url, destino) {
  if (existsSync(destino)) return true;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    await writeFile(destino, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch (err) {
    avisos.push(`miniatura não baixada (${path.basename(destino)}): ${err.message}`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const slug = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--inicio") ?? "sabrina";
  const iArg = args.indexOf("--inicio");

  const config = await lerJson(path.join(ROOT, "config", `${slug}.json`));
  const atividades = await talvezJson(path.join(ROOT, "data", `${slug}-atividades.json`));
  const inicio = iArg >= 0 ? args[iArg + 1] : atividades?.periodo?.inicio;
  if (!inicio) throw new Error("Informe --inicio ou gere data/<slug>-atividades.json antes.");

  // Meta: semana pedida + histórico
  const histDir = path.join(ROOT, "data", "historico", slug);
  const semanas = [];
  if (existsSync(histDir)) {
    for (const f of (await readdir(histDir)).filter((x) => /^meta-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort()) {
      semanas.push(await lerJson(path.join(histDir, f)));
    }
  }
  const meta = semanas.find((s) => s.periodo.inicio === inicio) ?? null;
  if (!meta) avisos.push(`sem dados da Meta para a semana ${inicio} (rode scripts/meta.mjs ${slug} --inicio ${inicio})`);
  const historico = semanas.map(resumoSemana).filter((s) => s.inicio <= inicio);
  const anteriores = historico.filter((s) => s.inicio < inicio).slice(-4);

  if (atividades && atividades.periodo.inicio !== inicio) {
    avisos.push(`atividades são da semana ${atividades.periodo.inicio}, relatório é de ${inicio}: bloco de atividades omitido`);
  }

  // Textos do time (por semana)
  const textos = (await talvezJson(path.join(ROOT, "content", `${slug}-semana.json`)))?.semanas?.[inicio] ?? null;
  if (!textos) avisos.push(`sem textos em content/${slug}-semana.json para ${inicio}: destaques e próximos passos ficam vazios`);

  // Miniaturas dos posts de destaque (as URLs da Meta expiram)
  if (meta?.instagram?.posts?.length) {
    const dir = path.join(ROOT, "data", "midia", slug);
    await mkdir(dir, { recursive: true });
    // Só as 3 de maior alcance aparecem com imagem na página.
    const top = [...meta.instagram.posts].sort((a, z) => (z.reach ?? 0) - (a.reach ?? 0)).slice(0, 3);
    for (const p of top) {
      if (!p.imagem) continue;
      const arq = path.join(dir, `${p.id}.jpg`);
      if (await baixarMiniatura(p.imagem, arq)) p.miniatura = path.relative(ROOT, arq).split(path.sep).join("/");
    }
  }

  const fim = meta?.periodo?.fim ?? atividades?.periodo?.fim;
  const { $comentario, ...marca } = config.marca ?? {};
  const saida = {
    schema_version: 1,
    cliente: { nome: config.cliente.nome, slug },
    marca,
    periodo: { inicio, fim, rotulo: rotulo(inicio, fim) },
    modulos: config.modulos ?? ["atividades", "instagram", "anuncios"],
    textos: textos ?? { revisado: false, destaques: null, aprendizados: [], marcos: [], proximos_passos: [] },
    atividades: atividades?.periodo?.inicio === inicio ? atividades : null,
    meta,
    historico,
    comparacao: {
      semanas_base: anteriores.length,
      anterior: anteriores.at(-1) ?? null,
      media: anteriores.length
        ? Object.fromEntries(["alcance", "visualizacoes", "interacoes", "contas_engajadas", "novos_seguidores", "publicacoes", "investimento"].map((k) => [k, mediaDe(anteriores, k)]))
        : null,
    },
    fonte: { montado_em: new Date().toISOString() },
  };

  const destino = path.join(ROOT, "data", `${slug}-relatorio.json`);
  await writeFile(destino, JSON.stringify(saida, null, 2) + "\n");
  console.log(`✓ ${path.relative(ROOT, destino)} · ${saida.periodo.rotulo}`);
  console.log(`  módulos: ${saida.modulos.join(", ")} · histórico: ${historico.length} semanas · textos ${textos ? (textos.revisado ? "revisados" : "em rascunho") : "ausentes"}`);
  for (const a of [...new Set(avisos)]) console.log(`  ! ${a}`);
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
