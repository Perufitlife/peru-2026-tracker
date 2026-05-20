#!/usr/bin/env node
/**
 * fetch_polymarket.js — pull en vivo de Polymarket para 2da vuelta Perú 2026.
 *
 * Llama a la Gamma API y extrae los markets de Keiko + Sánchez del evento
 * "Peru Presidential Election Winner". Calcula prob normalizada, volúmenes
 * y voto implícito. Escribe polymarket_live.json.
 *
 * Si falla: NO sobreescribe el archivo previo. El build sigue usando la última
 * snapshot conocida.
 *
 * Uso:
 *   node fetch_polymarket.js              # fetch + write
 *   node fetch_polymarket.js --stdout     # solo print, no write
 */

const fs = require("fs");
const https = require("https");

const EVENT_SLUG = "peru-presidential-election-winner";
const OUT = "./polymarket_live.json";

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "perufitlife/onpe-tracker" } }, res => {
      if (res.statusCode !== 200) {
        return reject(new Error("HTTP " + res.statusCode));
      }
      let body = "";
      res.on("data", c => body += c);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const stdoutOnly = args.includes("--stdout");

  const events = await fetchJSON(`https://gamma-api.polymarket.com/events?slug=${EVENT_SLUG}`);
  if (!events || !events[0]) throw new Error("evento no encontrado");
  const ev = events[0];

  function findMarket(needle) {
    return (ev.markets || []).find(m => m.question.toLowerCase().includes(needle.toLowerCase()));
  }

  const mK = findMarket("Keiko Fujimori");
  const mS = findMarket("Roberto Sánchez") || findMarket("Roberto Sanchez");
  if (!mK || !mS) throw new Error("markets K/S no encontrados");

  function priceYes(m) {
    const arr = JSON.parse(m.outcomePrices);
    const out = JSON.parse(m.outcomes);
    const idx = out.indexOf("Yes");
    return parseFloat(arr[idx]);
  }

  const pK = priceYes(mK);   // P(Keiko gana)
  const pS = priceYes(mS);   // P(Sánchez gana)

  // Normaliza (suman <100% por liquidity / other-candidate residual)
  const sum = pK + pS;
  const pK_norm = pK / sum;
  const pS_norm = pS / sum;

  // %K implícito en voto: si P(K gana) = 0.74, escenario condicional ~52% en victoria K
  // y ~48% en victoria S. Voto esperado = pK*52 + pS*48.
  const pctKImplied = pK_norm * 52 + pS_norm * 48;

  const out = {
    fetched_at: new Date().toISOString(),
    source: "polymarket_gamma_api",
    event: {
      id: ev.id,
      slug: ev.slug,
      title: ev.title,
      url: "https://polymarket.com/event/" + EVENT_SLUG,
    },
    markets: {
      keiko: {
        question: mK.question,
        slug: mK.slug,
        price_yes: pK,
        volume_total: parseFloat(mK.volume) || 0,
        volume_24h: parseFloat(mK.volume24hr) || 0,
        liquidity: parseFloat(mK.liquidity) || 0,
        last_trade_at: mK.lastTradeTime || null,
      },
      sanchez: {
        question: mS.question,
        slug: mS.slug,
        price_yes: pS,
        volume_total: parseFloat(mS.volume) || 0,
        volume_24h: parseFloat(mS.volume24hr) || 0,
        liquidity: parseFloat(mS.liquidity) || 0,
        last_trade_at: mS.lastTradeTime || null,
      },
    },
    prob_keiko_gana: +pK_norm.toFixed(4),
    prob_sanchez_gana: +pS_norm.toFixed(4),
    prob_residual: +(1 - sum).toFixed(4),
    pct_k_implied_voto: +pctKImplied.toFixed(2),
    volumen_usd_total: Math.round((parseFloat(mK.volume) || 0) + (parseFloat(mS.volume) || 0)),
    volumen_24h_usd: Math.round((parseFloat(mK.volume24hr) || 0) + (parseFloat(mS.volume24hr) || 0)),
  };

  if (stdoutOnly) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`✅ Polymarket actualizado:`);
  console.log(`   Keiko:   ${(out.prob_keiko_gana*100).toFixed(1)}% (${(out.markets.keiko.price_yes*100).toFixed(1)}¢)`);
  console.log(`   Sánchez: ${(out.prob_sanchez_gana*100).toFixed(1)}% (${(out.markets.sanchez.price_yes*100).toFixed(1)}¢)`);
  console.log(`   %K voto implícito: ${out.pct_k_implied_voto}%`);
  console.log(`   Volumen total: $${(out.volumen_usd_total/1e6).toFixed(2)}M · 24h: $${(out.volumen_24h_usd/1e3).toFixed(0)}K`);
}

main().catch(e => {
  console.error("❌ Polymarket fetch falló:", e.message);
  console.error("   Build seguirá con polymarket_live.json previo (si existe).");
  process.exit(1);
});
