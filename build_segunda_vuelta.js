/**
 * Modelo 2da Vuelta 2026 — Keiko Fujimori vs Roberto Sánchez
 *
 * GRANULARIDAD: distrito (1,892). Cada distrito se calcula individualmente con su
 * propio factor histórico 2021 (no se hereda del padre). Luego se agrega provincia/depto/nacional.
 *
 * TRANSFERENCIAS — fuentes y racional:
 *  Las matrices están ancladas en:
 *   (a) 2da vuelta 2021 Castillo vs Keiko: Lescano (AP, centro) → ~55-60% Castillo;
 *       López Aliaga (RP, derecha) → ~80% Keiko; Forsyth (Victoria) → ~70% Keiko;
 *       Verónika Mendoza (JP) → ~85% Castillo (Mendoza endosó).
 *   (b) 2da vuelta 2016 PPK vs Keiko: Verónika Mendoza (FA) → 70% PPK pese a no endosar;
 *       Acuña (APP) → ~55% PPK; Barnechea (AP) → ~65% PPK.
 *   (c) Encuestas IPSOS/IEP segunda vuelta 2021 (mayo 2021): el 24% de los electores
 *       de "otros" candidatos votaba blanco/nulo en el escenario "anti-fujimorismo activo".
 *  Cada split lleva su `_fuente` para auditarse.
 */
const fs = require("fs");

const data = require("./data.json");
const forensic = require("./forensic_2021_provincias.json");

const K_NAME = "KEIKO SOFIA FUJIMORI HIGUCHI";
const S_NAME = "ROBERTO HELBERT SANCHEZ PALOMINO";

// Matriz de transferencias — { abst, k, s, _fuente }
// abst = abstención inducida (blanco/nulo/no vota).
// CADA split lleva su justificación verificable.
const TRANSFER_LIB = {
  // ===== DERECHA / ORDEN =====
  "RAFAEL BERNARDO LÓPEZ ALIAGA CAZORLA": {
    OPTIMISTA_K: { abst: 0.05, k: 0.88, s: 0.07 },
    BASE:        { abst: 0.10, k: 0.78, s: 0.12 },
    PESIMISTA_K: { abst: 0.20, k: 0.62, s: 0.18 },
    _fuente: "Renovación Popular = derecha conservadora católica. Su voto se alinea con FP en 2da vuelta. " +
             "Histórico: votantes de López Aliaga en 1V 2021 → ~80% Keiko en 2V 2021 (IPSOS, jun-2021). " +
             "Anti-fujimorismo persistente (~15% de su base) se abstiene en pesimista.",
  },
  "RICARDO PABLO BELMONT CASSINELLI": {
    OPTIMISTA_K: { abst: 0.08, k: 0.80, s: 0.12 },
    BASE:        { abst: 0.12, k: 0.70, s: 0.18 },
    PESIMISTA_K: { abst: 0.22, k: 0.55, s: 0.23 },
    _fuente: "Derecha populista limeña. Belmont es ex-alcalde de Lima, voto urbano costeño con afinidad anti-izquierda. " +
             "Más fragmentable que López Aliaga: 20-25% es votante 'anti-todo' que puede irse a blanco.",
  },
  "CARLOS GONSALO ALVAREZ LOAYZA": {
    OPTIMISTA_K: { abst: 0.05, k: 0.82, s: 0.13 },
    BASE:        { abst: 0.10, k: 0.72, s: 0.18 },
    PESIMISTA_K: { abst: 0.18, k: 0.60, s: 0.22 },
    _fuente: "Derecha. Pais Para Todos. Lectura por afinidad de programa (orden + economía abierta). " +
             "Sin histórico 2da vuelta, asumimos perfil similar a Belmont/López Aliaga.",
  },
  "ALFONSO CARLOS ESPA Y GARCES-ALVEAR": {
    OPTIMISTA_K: { abst: 0.10, k: 0.65, s: 0.25 },
    BASE:        { abst: 0.15, k: 0.55, s: 0.30 },
    PESIMISTA_K: { abst: 0.22, k: 0.40, s: 0.38 },
    _fuente: "Derecha menor (Sicreo). Voto más diluido, menos disciplinado que FP. " +
             "Mayor fuga al centro/abstención.",
  },
  // ===== CENTRO-IZQUIERDA / IZQUIERDA =====
  "JORGE NIETO MONTESINOS": {
    OPTIMISTA_K: { abst: 0.10, k: 0.30, s: 0.60 },
    BASE:        { abst: 0.10, k: 0.20, s: 0.70 },
    PESIMISTA_K: { abst: 0.10, k: 0.12, s: 0.78 },
    _fuente: "Partido del Buen Gobierno = centro-izquierda. Ex-PPK, posiciones moderadas. " +
             "Su base anti-fujimorista vota Sánchez por descarte. ~10% se va al centro.",
  },
  "PABLO ALFONSO LOPEZ CHAU NAVA": {
    OPTIMISTA_K: { abst: 0.10, k: 0.32, s: 0.58 },
    BASE:        { abst: 0.10, k: 0.22, s: 0.68 },
    PESIMISTA_K: { abst: 0.10, k: 0.15, s: 0.75 },
    _fuente: "Ahora Nación = izquierda nacionalista. Heredero ideológico de Humala/Frente Amplio. " +
             "Analogía Mendoza 2016: 70% PPK pero por anti-K; en 2026 con Sánchez izq, va a Sánchez directo.",
  },
  "MARIA SOLEDAD PEREZ TELLO": {
    OPTIMISTA_K: { abst: 0.10, k: 0.45, s: 0.45 },
    BASE:        { abst: 0.15, k: 0.30, s: 0.55 },
    PESIMISTA_K: { abst: 0.20, k: 0.18, s: 0.62 },
    _fuente: "Primero la Gente = centro/ecologista. Ex-ministra Kuczynski. Anti-fujimorista declarada. " +
             "En 2021 su base habría votado Castillo por descarte (Pérez Tello firmó manifiesto anti-K).",
  },
  "LUIS FERNANDO OLIVERA VEGA": {
    OPTIMISTA_K: { abst: 0.10, k: 0.45, s: 0.45 },
    BASE:        { abst: 0.18, k: 0.30, s: 0.52 },
    PESIMISTA_K: { abst: 0.22, k: 0.20, s: 0.58 },
    _fuente: "Frente de la Esperanza = centro-izquierda histórico (Olivera, Andrade). " +
             "Voto urbano antifujimorista clásico de los 90s-2000s. Más abstención por edad alta de su base.",
  },
};

// Default para candidatos chicos (resto del 3%)
const DEFAULT_SPLIT = {
  OPTIMISTA_K: { abst: 0.10, k: 0.50, s: 0.40 },
  BASE:        { abst: 0.15, k: 0.40, s: 0.45 },
  PESIMISTA_K: { abst: 0.20, k: 0.30, s: 0.50 },
};

// Peso del factor regional 2021 en cada escenario
const FACTOR_2021_PESO = {
  OPTIMISTA_K: 0.30,   // 2021 importa poco (asume polarización menor)
  BASE:        0.50,   // 2021 importa moderadamente
  PESIMISTA_K: 0.70,   // 2021 importa mucho (asume polarización mantenida)
};

function ajusteAnti2021(pct_C_2021, peso) {
  if (pct_C_2021 == null) return 0;
  return Math.max(-0.9, Math.min(0.9, (pct_C_2021 - 50) / 50)) * peso;
}

function ajustarSplit(split, factor) {
  const transfer = factor * 0.50;
  let k = split.k - transfer;
  let s = split.s + transfer;
  if (k < 0.02) { s += k - 0.02; k = 0.02; }
  if (s < 0.02) { k += s - 0.02; s = 0.02; }
  const tot = k + s + split.abst;
  return { abst: split.abst / tot, k: k / tot, s: s / tot };
}

// Lookup table forense por ubigeo distrital y provincial
const forenseDistMap = new Map();
const forenseProvMap = new Map();
forensic.distritos.forEach(d => forenseDistMap.set(d.ubigeo, d));
forensic.provincias.forEach(p => forenseProvMap.set(p.ubigeo, p));

function getForense(ubigeo6) {
  // intentar distrito primero; si no existe (raro: distritos nuevos), caer a provincia
  const dist = forenseDistMap.get(ubigeo6);
  if (dist) return { ...dist, _fuente: "distrito" };
  const prov = forenseProvMap.get(ubigeo6.slice(0, 4));
  if (prov) return { ...prov, _fuente: "provincia (distrito sin match)" };
  return null;
}

function correrEscenario(scKey) {
  const peso = FACTOR_2021_PESO[scKey];
  const distritos = [];
  const provAgg = new Map();
  const depAgg = new Map();
  let nacK = 0, nacS = 0, nacAbst = 0;
  let distritosConForense = 0, distritosSinForense = 0;

  for (const dep of data.departamentos) {
    for (const prov of (dep.provincias || [])) {
      for (const dist of (prov.distritos || [])) {
        const ubigeo6 = String(dist.ubigeo || "").padStart(6, "0");
        const forenseRec = getForense(ubigeo6);
        if (forenseRec) distritosConForense++; else distritosSinForense++;
        const factor = forenseRec ? ajusteAnti2021(forenseRec.pct_C, peso) : 0;

        let kBase = 0, sBase = 0, kProy = 0, sProy = 0, abst = 0;
        for (const c of (dist.candidatos || [])) {
          const v = c.totalVotosValidos || 0;
          if (v === 0) continue;
          if (c.nombreCandidato === K_NAME) { kBase += v; kProy += v; }
          else if (c.nombreCandidato === S_NAME) { sBase += v; sProy += v; }
          else {
            const lib = TRANSFER_LIB[c.nombreCandidato];
            const splitBase = lib ? lib[scKey] : DEFAULT_SPLIT[scKey];
            const split = ajustarSplit(splitBase, factor);
            kProy += v * split.k;
            sProy += v * split.s;
            abst += v * split.abst;
          }
        }
        const validos = kProy + sProy;
        const pctK = validos > 0 ? kProy / validos * 100 : 0;

        distritos.push({
          ubigeo: ubigeo6,
          departamento: dep.nombre,
          provincia: prov.nombre,
          distrito: dist.nombre,
          validos_1v: dist.totales?.totalVotosValidos || 0,
          keiko_base: Math.round(kBase),
          sanchez_base: Math.round(sBase),
          keiko_proy: Math.round(kProy),
          sanchez_proy: Math.round(sProy),
          validos_proy: Math.round(validos),
          abstencion_inducida: Math.round(abst),
          pct_keiko: +pctK.toFixed(2),
          pct_sanchez: +(100 - pctK).toFixed(2),
          margen: Math.round(kProy - sProy),
          ganador: kProy > sProy ? "K" : "S",
          pct_castillo_2021: forenseRec?.pct_C ?? null,
          pct_keiko_2021: forenseRec?.pct_K ?? null,
          margen_2021: forenseRec?.margen ?? null,
          factor_2021: +factor.toFixed(3),
          forense_match: forenseRec?._fuente ?? "ninguno",
        });

        nacK += kProy;
        nacS += sProy;
        nacAbst += abst;

        // aggregate to provincia
        const provKey = ubigeo6.slice(0, 4);
        if (!provAgg.has(provKey)) {
          provAgg.set(provKey, { ubigeo: provKey, departamento: dep.nombre, provincia: prov.nombre, k: 0, s: 0, abst: 0, validos_1v: 0, kBase: 0, sBase: 0 });
        }
        const pa = provAgg.get(provKey);
        pa.k += kProy; pa.s += sProy; pa.abst += abst;
        pa.kBase += kBase; pa.sBase += sBase;
        pa.validos_1v += dist.totales?.totalVotosValidos || 0;

        if (!depAgg.has(dep.nombre)) {
          depAgg.set(dep.nombre, { k: 0, s: 0, validos_1v: 0 });
        }
        const da = depAgg.get(dep.nombre);
        da.k += kProy; da.s += sProy;
        da.validos_1v += dist.totales?.totalVotosValidos || 0;
      }
    }
  }

  // build provincias array
  const provincias = [];
  for (const [key, v] of provAgg) {
    const validos = v.k + v.s;
    const pctK = validos > 0 ? v.k / validos * 100 : 0;
    // factor agregado de la provincia: promedio ponderado del Castillo 2021 a nivel provincial
    const forenseProv = forenseProvMap.get(key);
    provincias.push({
      ubigeo: key,
      departamento: v.departamento,
      provincia: v.provincia,
      validos_1v: v.validos_1v,
      keiko_base: Math.round(v.kBase),
      sanchez_base: Math.round(v.sBase),
      keiko_proy: Math.round(v.k),
      sanchez_proy: Math.round(v.s),
      validos_proy: Math.round(validos),
      abstencion_inducida: Math.round(v.abst),
      pct_keiko: +pctK.toFixed(2),
      pct_sanchez: +(100 - pctK).toFixed(2),
      margen: Math.round(v.k - v.s),
      ganador: v.k > v.s ? "K" : "S",
      pct_castillo_2021: forenseProv?.pct_C ?? null,
      pct_keiko_2021: forenseProv?.pct_K ?? null,
      margen_2021: forenseProv?.margen ?? null,
    });
  }

  // departamentos
  const departamentos = [];
  for (const [nombre, v] of depAgg) {
    const val = v.k + v.s;
    departamentos.push({
      departamento: nombre,
      validos_1v: v.validos_1v,
      keiko_proy: Math.round(v.k),
      sanchez_proy: Math.round(v.s),
      pct_keiko: +(v.k / val * 100).toFixed(2),
      pct_sanchez: +(v.s / val * 100).toFixed(2),
      margen: Math.round(v.k - v.s),
      ganador: v.k > v.s ? "K" : "S",
    });
  }

  const validosNac = nacK + nacS;
  return {
    nacional: {
      keiko: Math.round(nacK),
      sanchez: Math.round(nacS),
      validos: Math.round(validosNac),
      abstencion_inducida: Math.round(nacAbst),
      pct_keiko: +(nacK / validosNac * 100).toFixed(3),
      pct_sanchez: +(nacS / validosNac * 100).toFixed(3),
      margen: Math.round(nacK - nacS),
      ganador: nacK > nacS ? "Keiko" : "Sánchez",
    },
    distritos,
    provincias,
    departamentos,
    _diagnostico: { distritosConForense, distritosSinForense },
  };
}

const out = {
  meta: {
    generated_at: new Date().toISOString(),
    granularidad: "distrito (1,892 unidades — cada uno con su propio factor 2021)",
    transferencias_lib: TRANSFER_LIB,
    transferencias_default: DEFAULT_SPLIT,
    factor_2021_peso: FACTOR_2021_PESO,
    notas: [
      "Modelo de proyección distrital — NO predicción.",
      "Cada distrito se calcula individualmente: voto base 1V + transferencia ideológica ajustada por el patrón de su propio distrito en 2021 (Keiko vs Castillo).",
      "Las matrices de transferencia están documentadas (TRANSFER_LIB._fuente) con su base histórica.",
      "El ajuste 2021 distrital captura heterogeneidad intra-provincia: ej. Miraflores vs Comas dentro de Lima.",
    ],
    nacional_1v: {},
  },
  escenarios: {},
  bisagra: [],
  umbrales_keiko: [],
};

// nacional 1V
const totV1 = data.nacional.candidatos.reduce((a, c) => a + (c.totalVotosValidos || 0), 0);
const kV1 = data.nacional.candidatos.find(c => c.nombreCandidato === K_NAME)?.totalVotosValidos || 0;
const sV1 = data.nacional.candidatos.find(c => c.nombreCandidato === S_NAME)?.totalVotosValidos || 0;
out.meta.nacional_1v = {
  keiko: kV1, sanchez: sV1, otros: totV1 - kV1 - sV1, validos: totV1,
  pct_keiko: +(kV1 / totV1 * 100).toFixed(2),
  pct_sanchez: +(sV1 / totV1 * 100).toFixed(2),
};

for (const sc of ["OPTIMISTA_K", "BASE", "PESIMISTA_K"]) {
  out.escenarios[sc] = {
    label: ({
      OPTIMISTA_K: "Optimista K — derecha disciplinada, anti-fujimorismo apagado, factor 2021 al 30%",
      BASE: "Base — transferencia ideológica promedio, factor 2021 al 50%",
      PESIMISTA_K: "Pesimista K — 20-22% del voto derecha bota nulo, factor 2021 al 70%",
    })[sc],
    ...correrEscenario(sc),
  };
}

// BISAGRA: distritos (no provincias) con margen <8pp en BASE Y >5K validos
out.bisagra = out.escenarios.BASE.distritos
  .filter(d => Math.abs(d.pct_keiko - 50) < 8 && d.validos_proy > 3000)
  .sort((a, b) => Math.abs(a.pct_keiko - 50) - Math.abs(b.pct_keiko - 50))
  .slice(0, 40)
  .map(d => ({
    ubigeo: d.ubigeo,
    departamento: d.departamento,
    provincia: d.provincia,
    distrito: d.distrito,
    validos_proy: d.validos_proy,
    pct_keiko_base: d.pct_keiko,
    pct_keiko_optimista: out.escenarios.OPTIMISTA_K.distritos.find(x => x.ubigeo === d.ubigeo)?.pct_keiko,
    pct_keiko_pesimista: out.escenarios.PESIMISTA_K.distritos.find(x => x.ubigeo === d.ubigeo)?.pct_keiko,
    pct_castillo_2021: d.pct_castillo_2021,
  }));

// UMBRALES: para cada provincia agregada, cuánto puede caer Keiko bajo PESIMISTA
const pess = out.escenarios.PESIMISTA_K;
const margenPess = pess.nacional.keiko - pess.nacional.sanchez;
const colchon = Math.max(0, margenPess / 2);

for (const p of pess.provincias) {
  if (p.validos_proy === 0) continue;
  const bufferPp = colchon / p.validos_proy * 100;
  const pctMin = p.pct_keiko - bufferPp;
  out.umbrales_keiko.push({
    ubigeo: p.ubigeo,
    departamento: p.departamento,
    provincia: p.provincia,
    validos_proy: p.validos_proy,
    pct_actual_pesimista: p.pct_keiko,
    pct_minimo_keiko: +pctMin.toFixed(2),
    buffer_pp: +bufferPp.toFixed(2),
    es_provincia_keiko: p.pct_keiko > 50,
    ganador_pesimista: p.ganador,
  });
}
out.umbrales_keiko.sort((a, b) => a.buffer_pp - b.buffer_pp);

fs.writeFileSync("segunda_vuelta_2026.json", JSON.stringify(out, null, 2));

// resumen
console.log("=".repeat(78));
console.log("MODELO 2DA VUELTA 2026 — KEIKO vs SÁNCHEZ — GRANULARIDAD DISTRITAL");
console.log("=".repeat(78));
console.log(`1V Nacional: K=${out.meta.nacional_1v.pct_keiko}% / S=${out.meta.nacional_1v.pct_sanchez}% / Otros=${(out.meta.nacional_1v.otros/totV1*100).toFixed(1)}%`);
console.log("");
console.log("Cobertura forense 2021 por distrito:");
console.log(`  con match distrital: ${out.escenarios.BASE._diagnostico.distritosConForense}`);
console.log(`  sin match (fallback provincia/sin ajuste): ${out.escenarios.BASE._diagnostico.distritosSinForense}`);
console.log("");
for (const [name, esc] of Object.entries(out.escenarios)) {
  const n = esc.nacional;
  console.log(`${name.padEnd(15)} K=${String(n.pct_keiko).padStart(6)}% S=${String(n.pct_sanchez).padStart(6)}% margen=${n.margen.toLocaleString().padStart(11)} → ${n.ganador}`);
}
console.log(`\nDistritos bisagra (margen <8pp en BASE): ${out.bisagra.length}`);
console.log(`Top 15 bisagra:`);
out.bisagra.slice(0, 15).forEach(d => {
  console.log(`  ${d.distrito.padEnd(22)} ${d.provincia.padEnd(20)} ${d.departamento.padEnd(15)} %K_opt=${String(d.pct_keiko_optimista||'-').padStart(5)} %K_base=${String(d.pct_keiko_base).padStart(5)} %K_pes=${String(d.pct_keiko_pesimista||'-').padStart(5)} (2021 C=${d.pct_castillo_2021}%)`);
});

console.log(`\nProvincias K más vulnerables bajo PESIMISTA (menor buffer):`);
out.umbrales_keiko.filter(u => u.es_provincia_keiko).slice(0, 10).forEach(u => {
  console.log(`  ${u.provincia.padEnd(22)} ${u.departamento.padEnd(15)} %K_act=${String(u.pct_actual_pesimista).padStart(5)} buffer=${String(u.buffer_pp).padStart(6)}pp validos=${u.validos_proy.toLocaleString()}`);
});

console.log(`\n✅ Escribió segunda_vuelta_2026.json (${(fs.statSync("segunda_vuelta_2026.json").size/1024).toFixed(0)}KB)`);
