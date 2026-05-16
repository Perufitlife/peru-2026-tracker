/**
 * Modelo 2da Vuelta 2026: Keiko Fujimori vs Roberto Sánchez
 *
 * 3 escenarios de transferencia:
 *   - OPTIMISTA_K:  derecha vota 90% K, centro 50/50, anti-fujimorismo apagado
 *   - BASE:         heurística promedio (lo más realista a priori)
 *   - PESIMISTA_K:  anti-fujimorismo fuerte → 25% del voto derecha bota nulo,
 *                   centro se va 65% a S, sur andino refuerza patrón 2021
 *
 * Output JSON tiene los 3 escenarios + provincias bisagra (margen <10pp en base) +
 * el umbral mínimo que Keiko necesita en provincias clave bajo el escenario pesimista.
 */
const fs = require("fs");

const data = require("./data.json");
const forensic2021 = require("./forensic_2021_provincias.json");

// 3 matrices de transferencia
const ESCENARIOS = {
  OPTIMISTA_K: {
    label: "Optimista K (transferencia derecha máxima, anti-fujimorismo apagado)",
    factor_2021_peso: 0.30,    // peso del rechazo regional sur andino
    transferencias: {
      "RAFAEL BERNARDO LÓPEZ ALIAGA CAZORLA":  { abst: 0.05, k: 0.88, s: 0.07 },
      "RICARDO PABLO BELMONT CASSINELLI":      { abst: 0.08, k: 0.80, s: 0.12 },
      "CARLOS GONSALO ALVAREZ LOAYZA":         { abst: 0.05, k: 0.82, s: 0.13 },
      "ALFONSO CARLOS ESPA Y GARCES-ALVEAR":   { abst: 0.10, k: 0.65, s: 0.25 },
      "JORGE NIETO MONTESINOS":                { abst: 0.10, k: 0.30, s: 0.60 },
      "PABLO ALFONSO LOPEZ CHAU NAVA":         { abst: 0.10, k: 0.32, s: 0.58 },
      "MARIA SOLEDAD PEREZ TELLO":             { abst: 0.10, k: 0.45, s: 0.45 },
      "LUIS FERNANDO OLIVERA VEGA":            { abst: 0.10, k: 0.45, s: 0.45 },
    },
    default: { abst: 0.10, k: 0.50, s: 0.40 },
  },
  BASE: {
    label: "Base (heurística promedio)",
    factor_2021_peso: 0.50,
    transferencias: {
      "RAFAEL BERNARDO LÓPEZ ALIAGA CAZORLA":  { abst: 0.10, k: 0.78, s: 0.12 },
      "RICARDO PABLO BELMONT CASSINELLI":      { abst: 0.12, k: 0.70, s: 0.18 },
      "CARLOS GONSALO ALVAREZ LOAYZA":         { abst: 0.10, k: 0.72, s: 0.18 },
      "ALFONSO CARLOS ESPA Y GARCES-ALVEAR":   { abst: 0.15, k: 0.55, s: 0.30 },
      "JORGE NIETO MONTESINOS":                { abst: 0.10, k: 0.20, s: 0.70 },
      "PABLO ALFONSO LOPEZ CHAU NAVA":         { abst: 0.10, k: 0.22, s: 0.68 },
      "MARIA SOLEDAD PEREZ TELLO":             { abst: 0.15, k: 0.30, s: 0.55 },
      "LUIS FERNANDO OLIVERA VEGA":            { abst: 0.18, k: 0.30, s: 0.52 },
    },
    default: { abst: 0.15, k: 0.40, s: 0.45 },
  },
  PESIMISTA_K: {
    label: "Pesimista K (anti-fujimorismo activo, derecha se fragmenta)",
    factor_2021_peso: 0.70,
    transferencias: {
      "RAFAEL BERNARDO LÓPEZ ALIAGA CAZORLA":  { abst: 0.20, k: 0.62, s: 0.18 },
      "RICARDO PABLO BELMONT CASSINELLI":      { abst: 0.22, k: 0.55, s: 0.23 },
      "CARLOS GONSALO ALVAREZ LOAYZA":         { abst: 0.18, k: 0.60, s: 0.22 },
      "ALFONSO CARLOS ESPA Y GARCES-ALVEAR":   { abst: 0.22, k: 0.40, s: 0.38 },
      "JORGE NIETO MONTESINOS":                { abst: 0.10, k: 0.12, s: 0.78 },
      "PABLO ALFONSO LOPEZ CHAU NAVA":         { abst: 0.10, k: 0.15, s: 0.75 },
      "MARIA SOLEDAD PEREZ TELLO":             { abst: 0.20, k: 0.18, s: 0.62 },
      "LUIS FERNANDO OLIVERA VEGA":            { abst: 0.22, k: 0.20, s: 0.58 },
    },
    default: { abst: 0.20, k: 0.30, s: 0.50 },
  },
};

const K_NAME = "KEIKO SOFIA FUJIMORI HIGUCHI";
const S_NAME = "ROBERTO HELBERT SANCHEZ PALOMINO";

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

const forenseMap = new Map();
forensic2021.provincias.forEach(p => forenseMap.set(p.ubigeo, p));

function correrEscenario(esc) {
  const provincias = [];
  const depAgg = new Map();
  let nacK = 0, nacS = 0;

  for (const dep of data.departamentos) {
    for (const prov of (dep.provincias || [])) {
      const ubigeo6 = String(prov.ubigeo || "").padStart(6, "0");
      const ubigeo4 = ubigeo6.slice(0, 4);
      const forense = forenseMap.get(ubigeo4);
      const factor = forense ? ajusteAnti2021(forense.pct_C, esc.factor_2021_peso) : 0;

      let kBase = 0, sBase = 0, kProy = 0, sProy = 0, abst = 0;
      for (const c of (prov.candidatos || [])) {
        const v = c.totalVotosValidos || 0;
        if (c.nombreCandidato === K_NAME) { kBase += v; kProy += v; }
        else if (c.nombreCandidato === S_NAME) { sBase += v; sProy += v; }
        else {
          const tplBase = esc.transferencias[c.nombreCandidato] || esc.default;
          const tpl = ajustarSplit(tplBase, factor);
          kProy += v * tpl.k;
          sProy += v * tpl.s;
          abst += v * tpl.abst;
        }
      }
      const validosProy = kProy + sProy;
      const pctK = validosProy > 0 ? kProy / validosProy * 100 : 0;
      provincias.push({
        ubigeo: ubigeo4,
        departamento: dep.nombre,
        provincia: prov.nombre,
        validos_1v: prov.totales?.totalVotosValidos || 0,
        keiko_base: kBase,
        sanchez_base: sBase,
        keiko_proy: Math.round(kProy),
        sanchez_proy: Math.round(sProy),
        validos_proy: Math.round(validosProy),
        abstencion_inducida: Math.round(abst),
        pct_keiko: +pctK.toFixed(2),
        pct_sanchez: +(100 - pctK).toFixed(2),
        margen: Math.round(kProy - sProy),
        ganador: kProy > sProy ? "K" : "S",
        pct_castillo_2021: forense?.pct_C ?? null,
        pct_keiko_2021: forense?.pct_K ?? null,
        margen_2021: forense?.margen ?? null,
      });
      nacK += kProy;
      nacS += sProy;
      if (!depAgg.has(dep.nombre)) depAgg.set(dep.nombre, { k: 0, s: 0 });
      const d = depAgg.get(dep.nombre);
      d.k += kProy;
      d.s += sProy;
    }
  }
  const validos = nacK + nacS;
  const dpts = [];
  for (const [nombre, v] of depAgg) {
    const val = v.k + v.s;
    dpts.push({
      departamento: nombre,
      keiko_proy: Math.round(v.k),
      sanchez_proy: Math.round(v.s),
      pct_keiko: +(v.k / val * 100).toFixed(2),
      pct_sanchez: +(v.s / val * 100).toFixed(2),
      margen: Math.round(v.k - v.s),
      ganador: v.k > v.s ? "K" : "S",
    });
  }
  return {
    nacional: {
      keiko: Math.round(nacK),
      sanchez: Math.round(nacS),
      validos: Math.round(validos),
      pct_keiko: +(nacK / validos * 100).toFixed(3),
      pct_sanchez: +(nacS / validos * 100).toFixed(3),
      margen: Math.round(nacK - nacS),
      ganador: nacK > nacS ? "Keiko" : "Sánchez",
    },
    provincias,
    departamentos: dpts,
  };
}

const out = {
  meta: {
    generated_at: new Date().toISOString(),
    nacional_1v: {},
    notas: [
      "Modelo de proyección — NO predicción. Los porcentajes asumen un patrón de transferencia ideológica que se valida con datos de campaña.",
      "Las heurísticas de transferencia usan el patrón de la 2da vuelta 2021 (Keiko vs Castillo) como ancla regional.",
      "El sur andino (Puno, Cusco, Apurímac, Ayacucho, Huancavelica) mantiene fuerte rechazo a Keiko en todos los escenarios.",
    ],
  },
  escenarios: {},
  bisagra: [],     // provincias con margen <10pp en BASE
  umbrales_keiko: [], // qué % necesita Keiko en provincias clave bajo PESIMISTA_K
};

// 1ra vuelta nacional
const totV1 = data.nacional.candidatos.reduce((a, c) => a + (c.totalVotosValidos || 0), 0);
const kV1 = data.nacional.candidatos.find(c => c.nombreCandidato === K_NAME)?.totalVotosValidos || 0;
const sV1 = data.nacional.candidatos.find(c => c.nombreCandidato === S_NAME)?.totalVotosValidos || 0;
out.meta.nacional_1v = {
  keiko: kV1, sanchez: sV1, otros: totV1 - kV1 - sV1, validos: totV1,
  pct_keiko: +(kV1 / totV1 * 100).toFixed(2),
  pct_sanchez: +(sV1 / totV1 * 100).toFixed(2),
};

for (const [name, esc] of Object.entries(ESCENARIOS)) {
  out.escenarios[name] = {
    label: esc.label,
    parametros: { factor_2021_peso: esc.factor_2021_peso, transferencias: esc.transferencias, default: esc.default },
    ...correrEscenario(esc),
  };
}

// PROVINCIAS BISAGRA (margen <12pp en BASE)
out.bisagra = out.escenarios.BASE.provincias
  .filter(p => Math.abs(p.pct_keiko - 50) < 12 && p.validos_proy > 5000)
  .sort((a, b) => Math.abs(a.pct_keiko - 50) - Math.abs(b.pct_keiko - 50))
  .map(p => ({
    ...p,
    pct_keiko_pesimista: out.escenarios.PESIMISTA_K.provincias.find(q => q.ubigeo === p.ubigeo)?.pct_keiko,
    pct_keiko_optimista: out.escenarios.OPTIMISTA_K.provincias.find(q => q.ubigeo === p.ubigeo)?.pct_keiko,
  }));

// UMBRALES KEIKO (bajo escenario PESIMISTA_K):
//   "¿Cuánto puede caer Keiko en cada provincia, manteniendo todo lo demás igual, antes de
//    que el resultado nacional cambie de Keiko ganando a Sánchez ganando?"
//
// Bajo PESIMISTA, margen actual = M (votos a favor de K).
// Si Keiko pierde votos en provincia i: pasa votos de K a S → margen baja 2 por cada voto.
// Para llevar margen a 0: necesitamos quitarle M/2 votos a Keiko en esa provincia.
// %K_mínimo_i = pct_keiko_i - (M/2) / validos_proy_i * 100
//
// Si %K_mínimo_i < 0 → la provincia es "irrelevante" en ese sentido (no se puede salvar por ahí).
// Si %K_mínimo_i > %K_actual → la provincia ya está perdida (debe RECUPERAR votos ahí, no defender).
const pess = out.escenarios.PESIMISTA_K;
const margenPess = pess.nacional.keiko - pess.nacional.sanchez;
const votosColchon = Math.max(0, margenPess / 2);

for (const p of pess.provincias) {
  if (p.validos_proy === 0) continue;
  const buffer_pp = votosColchon / p.validos_proy * 100;
  const pct_min = p.pct_keiko - buffer_pp;
  const pct_actual = p.pct_keiko;
  // Cuánto necesita SUBIR Keiko en esta provincia para EMPATAR nacional (solo aplica si ya pierde)
  const subida_para_empatar = margenPess < 0
    ? (-margenPess / 2) / p.validos_proy * 100
    : null;

  out.umbrales_keiko.push({
    ubigeo: p.ubigeo,
    departamento: p.departamento,
    provincia: p.provincia,
    validos_proy: p.validos_proy,
    pct_actual_pesimista: pct_actual,
    pct_minimo_keiko: +pct_min.toFixed(2),    // hasta cuánto puede caer
    buffer_pp: +buffer_pp.toFixed(2),         // colchón (puntos que puede ceder ahí)
    subida_para_empatar_si_pierde: subida_para_empatar ? +subida_para_empatar.toFixed(2) : null,
    es_provincia_keiko: pct_actual > 50,
    factible_defender: pct_min >= 0,
    ganador_pesimista: p.ganador,
  });
}
// Orden: provincias de Keiko con MENOR buffer (las más vulnerables a la sorpresa) primero
out.umbrales_keiko.sort((a, b) => {
  if (a.es_provincia_keiko !== b.es_provincia_keiko) return b.es_provincia_keiko - a.es_provincia_keiko;
  return (a.pct_actual_pesimista - a.pct_minimo_keiko) - (b.pct_actual_pesimista - b.pct_minimo_keiko);
});

fs.writeFileSync("segunda_vuelta_2026.json", JSON.stringify(out, null, 2));

// resumen
console.log("=".repeat(75));
console.log("MODELO 2DA VUELTA 2026 — KEIKO FUJIMORI vs ROBERTO SÁNCHEZ");
console.log("=".repeat(75));
console.log(`\n1ra vuelta: K=${out.meta.nacional_1v.pct_keiko}% / S=${out.meta.nacional_1v.pct_sanchez}% / Otros=${(out.meta.nacional_1v.otros/totV1*100).toFixed(1)}%`);
console.log("");
for (const [name, esc] of Object.entries(out.escenarios)) {
  const n = esc.nacional;
  console.log(`${name.padEnd(15)} K=${String(n.pct_keiko).padStart(6)}% S=${String(n.pct_sanchez).padStart(6)}% margen=${n.margen.toLocaleString().padStart(11)} → ${n.ganador}`);
}
console.log(`\nProvincias BISAGRA (margen <12pp en BASE, >5K validos): ${out.bisagra.length}`);
console.log("provincia".padEnd(25), "depto".padEnd(15), "%K_opt".padStart(7), "%K_base".padStart(8), "%K_pes".padStart(7), "validos".padStart(10));
out.bisagra.slice(0, 20).forEach(p => {
  console.log(
    p.provincia.padEnd(25),
    p.departamento.padEnd(15),
    String(p.pct_keiko_optimista || "-").padStart(7),
    String(p.pct_keiko).padStart(8),
    String(p.pct_keiko_pesimista || "-").padStart(7),
    String(p.validos_proy).padStart(10),
  );
});

console.log(`\nUMBRAL — hasta cuánto puede caer Keiko en sus provincias bajo PESIMISTA antes de perder nacional:`);
console.log("provincia".padEnd(25), "depto".padEnd(15), "%K_act".padStart(8), "%K_min".padStart(8), "buffer".padStart(8), "validos".padStart(10));
out.umbrales_keiko.filter(u => u.es_provincia_keiko).slice(0, 15).forEach(u => {
  console.log(
    u.provincia.padEnd(25),
    u.departamento.padEnd(15),
    String(u.pct_actual_pesimista).padStart(8),
    String(u.pct_minimo_keiko).padStart(8),
    String(u.buffer_pp).padStart(8),
    String(u.validos_proy).padStart(10),
  );
});

console.log(`\n✅ Escribió segunda_vuelta_2026.json (${(fs.statSync("segunda_vuelta_2026.json").size/1024).toFixed(0)}KB)`);
