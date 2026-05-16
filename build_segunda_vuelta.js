/**
 * MODELO 2DA VUELTA 2026 — Keiko vs Sánchez
 *
 * GRANULARIDAD: distrito (1,892). Cada distrito calcula su voto 2V individualmente.
 *
 * ESCENARIOS:
 *   1. ENCUESTAS  → anclado a IPSOS (23-24 abr) + IEP (21-25 abr). PRIMARIO.
 *      Calibra transferencias para que el agregado nacional reproduzca lo medido y
 *      respeta los crossbreaks regionales IEP (Lima/Norte/Centro/Sur/Oriente).
 *      Intra-región: distribuye usando el patrón Castillo 1V 2021 distrital
 *      (mejor predictor que 2V 2021 porque mide afinidad izquierda "pura").
 *
 *   2. OPTIMISTA_K → Keiko captura mejor el voto centro-derecha (rechazo K baja a ~40%).
 *   3. BASE        → Continuación de encuestas con leve corrección.
 *   4. PESIMISTA_K → Antifujimorismo se reactiva (rechazo K sube a ~55% como 2021).
 *
 * FUENTES INTEGRADAS:
 *  - IPSOS Perú21 23-24 abr 2026: K 38% / S 38% (empate técnico) / blanco-nulo 17%
 *  - IEP/La República 21-25 abr 2026: K 31% / S 32% / blanco-nulo 24% / NS 13%
 *    Sobre válido: K 49.2% / S 50.8%
 *    Cruces regionales IEP (% sobre total muestra):
 *      Lima Metropolitana:    K 41% / S 22%   → val K 65% / S 35%
 *      Costa Norte:           K 29% / S 34%   → val K 46% / S 54%
 *      Sierra Centro:         K 26% / S 40%   → val K 39% / S 61%
 *      Sierra Sur:            K 18% / S 39%   → val K 32% / S 68%
 *      Oriente (Selva):       K 29% / S 37%   → val K 44% / S 56%
 *    Cruces NSE: K (A/B 51%, C 36%, D/E 22%); S (A/B 20%, C 28%, D/E 38%).
 *  - Roberto Sánchez se autodefine "candidato castillista", ex-ministro Castillo.
 *  - Forense 2021 2da vuelta y 1ra vuelta por distrito (CSVs ONPE-PCM).
 */
const fs = require("fs");

const data = require("./data.json");
const forense2v = require("./forensic_2021_provincias.json");      // 2V 2021
const forense1v = require("./forensic_2021_1v_distritos.json");    // 1V 2021

const K_NAME = "KEIKO SOFIA FUJIMORI HIGUCHI";
const S_NAME = "ROBERTO HELBERT SANCHEZ PALOMINO";

// ====== ENCUESTAS — anclaje regional IEP (% sobre voto válido) ======
//
// El IEP da % sobre total respondientes. Para sacar % válido (sin blanco/nulo):
//   val_K = K / (K + S);  val_S = S / (K + S)
//
// Mapeo de cada departamento a una "zona IEP".
const ZONA_IEP_DEPTO = {
  "LIMA": "LIMA_METRO",       // Lima depto = Lima Metro (~95% del peso)
  "CALLAO": "LIMA_METRO",     // Callao en bloque con Lima Metro
  "TUMBES": "COSTA_NORTE",
  "PIURA": "COSTA_NORTE",
  "LAMBAYEQUE": "COSTA_NORTE",
  "LA LIBERTAD": "COSTA_NORTE",
  "ÁNCASH": "COSTA_NORTE",
  "ANCASH": "COSTA_NORTE",
  "ICA": "COSTA_SUR",         // costa sur, partido en encuestas → asumimos Centro
  "AREQUIPA": "COSTA_SUR",    // costa sur — más centro/sur
  "MOQUEGUA": "SIERRA_SUR",
  "TACNA": "SIERRA_SUR",
  "PUNO": "SIERRA_SUR",
  "CUSCO": "SIERRA_SUR",
  "APURÍMAC": "SIERRA_SUR",
  "APURIMAC": "SIERRA_SUR",
  "AYACUCHO": "SIERRA_SUR",
  "HUANCAVELICA": "SIERRA_SUR",
  "JUNÍN": "SIERRA_CENTRO",
  "JUNIN": "SIERRA_CENTRO",
  "HUÁNUCO": "SIERRA_CENTRO",
  "HUANUCO": "SIERRA_CENTRO",
  "PASCO": "SIERRA_CENTRO",
  "CAJAMARCA": "SIERRA_CENTRO",  // sierra norte → IEP "centro" más representativo
  "AMAZONAS": "SIERRA_CENTRO",
  "LORETO": "ORIENTE",
  "UCAYALI": "ORIENTE",
  "MADRE DE DIOS": "ORIENTE",
  "SAN MARTÍN": "ORIENTE",
  "SAN MARTIN": "ORIENTE",
  "EXTRANJERO": "LIMA_METRO",  // peruanos en el exterior — perfil urbano educado, más cerca de Lima
};

// Target IEP sobre voto válido (K_pct + S_pct = 100). Para SIERRA_NORTE: aproximamos como Sierra Centro.
// El bloque IEP "Centro" sólo cubre sierra; el "Norte" cubre costa norte.
const TARGET_VAL_IEP = {
  LIMA_METRO:    { k: 65, s: 35 },
  COSTA_NORTE:   { k: 46, s: 54 },
  COSTA_SUR:     { k: 50, s: 50 },   // costa sur híbrida — interpolación
  SIERRA_CENTRO: { k: 39, s: 61 },
  SIERRA_SUR:    { k: 32, s: 68 },
  ORIENTE:       { k: 44, s: 56 },
};

// Lookup forense por ubigeo
const forense1vMap = new Map();
forense1v.distritos.forEach(d => forense1vMap.set(d.ubigeo, d));
const forense2vDistMap = new Map();   // 2V por distrito (de forense2v.distritos)
forense2v.distritos.forEach(d => forense2vDistMap.set(d.ubigeo, d));

function getForense(ubigeo6) {
  return {
    "1v": forense1vMap.get(ubigeo6),
    "2v": forense2vDistMap.get(ubigeo6),
  };
}

// ============================================================
// ESCENARIO ENCUESTAS — calibración regional IEP
// ============================================================
//
// Mecánica:
//   Para cada distrito, asignamos voto K/S 2026 mediante 3 pasos:
//     1. Voto base = K_1V_2026 + S_1V_2026 (mantener — ya votaron por ellos)
//     2. Voto "otros" se reparte usando target regional + ajuste distrital por castillo_1V_2021
//     3. Validamos: el agregado por zona IEP debe ≈ target.
//
// Específicamente, para cada zona, ajustamos un parámetro `lambda_zona` tal que
// la suma por zona reproduzca el target. lambda es el % de "otros" que va a K en esa zona.

function distritoZona(dep) {
  return ZONA_IEP_DEPTO[dep] || "COSTA_SUR";
}

function correrEncuestas() {
  // Paso A: armar todos los distritos con su data básica
  const flatDist = [];
  for (const dep of data.departamentos) {
    for (const prov of (dep.provincias || [])) {
      for (const dist of (prov.distritos || [])) {
        const ubigeo6 = String(dist.ubigeo || "").padStart(6, "0");
        const fb = getForense(ubigeo6);
        let kBase = 0, sBase = 0, otrosTotal = 0;
        for (const c of (dist.candidatos || [])) {
          const v = c.totalVotosValidos || 0;
          if (c.nombreCandidato === K_NAME) kBase += v;
          else if (c.nombreCandidato === S_NAME) sBase += v;
          else otrosTotal += v;
        }
        // Indicador izquierdista 2021 distrital (% Castillo 1V): clave para asignar transferencia
        const pctCastillo1V = fb["1v"]?.pct_castillo ?? null;
        const pctIzqTotal1V = fb["1v"]?.pct_izq_total ?? null;
        const pctCastillo2V = fb["2v"]?.pct_C ?? null;

        flatDist.push({
          ubigeo: ubigeo6,
          departamento: dep.nombre,
          provincia: prov.nombre,
          distrito: dist.nombre,
          zona: distritoZona(dep.nombre),
          k_base: kBase,
          s_base: sBase,
          otros_total: otrosTotal,
          validos_1v: kBase + sBase + otrosTotal,
          pct_castillo_1v_2021: pctCastillo1V,
          pct_izq_total_1v_2021: pctIzqTotal1V,
          pct_castillo_2v_2021: pctCastillo2V,
        });
      }
    }
  }

  // Paso B: para cada zona, calibrar parámetros para alcanzar el target IEP
  //   Por simpleza: dentro de cada zona, asumimos que el voto "otros" se reparte
  //   linearmente con el % Castillo 1V 2021 distrital. El distrito más castillista
  //   manda 0% del "otros" a Keiko; el menos castillista manda γ% a Keiko.
  //   Resolvemos γ de modo que el agregado de zona iguale el target.
  //
  // Modelo intra-distrito:
  //   pct_otros_a_K_d = γ_zona * (1 - pct_castillo_1v_d / pct_castillo_1v_max_zona)
  //   pct_otros_a_S_d = δ_zona * (pct_castillo_1v_d / pct_castillo_1v_max_zona)
  //   pct_otros_a_abst_d = 1 - pct_otros_a_K_d - pct_otros_a_S_d
  //
  // Pero más simple: calibramos un SHARE de "otros" que va a K por zona, ajustado por castillo_1V:
  //   share_K(d) = baseK + (1 - 2*norm_castillo) * spread
  //   share_S(d) = baseS + (2*norm_castillo - 1) * spread
  //   donde norm_castillo = (pct_castillo_d - min_zona) / (max - min), en [0, 1]
  //
  // Calibramos baseK por zona para que el agregado dé el target. spread fijo = 0.25.

  const zonas = {};
  for (const d of flatDist) {
    if (!zonas[d.zona]) zonas[d.zona] = { distritos: [], min: Infinity, max: -Infinity };
    zonas[d.zona].distritos.push(d);
    const c = d.pct_castillo_1v_2021 ?? 19;  // si no hay data, asume promedio nacional
    zonas[d.zona].min = Math.min(zonas[d.zona].min, c);
    zonas[d.zona].max = Math.max(zonas[d.zona].max, c);
  }

  // Para cada zona, busca baseK que iguala el target
  const SPREAD = 0.25;
  const ABST_PROMEDIO = 0.30;  // ~30% de "otros" se abstiene/blanco (de los encuestados 17-24% blanco/nulo + 7-13% NS)
  for (const zonaKey of Object.keys(zonas)) {
    const z = zonas[zonaKey];
    const tgt = TARGET_VAL_IEP[zonaKey];
    if (!tgt) continue;
    const targetRatio = tgt.k / 100;  // K / (K+S) sobre valido

    // función que dado baseK calcula ratio agregado
    function agregado(baseK) {
      let totK = 0, totS = 0;
      for (const d of z.distritos) {
        const c = d.pct_castillo_1v_2021 ?? 19;
        const norm = z.max > z.min ? (c - z.min) / (z.max - z.min) : 0.5;
        const shareK = Math.max(0, baseK + (1 - 2 * norm) * SPREAD);
        // baseS implícito tal que share_abst ≈ ABST_PROMEDIO:
        const shareS = Math.max(0, (1 - ABST_PROMEDIO) - shareK);
        const fromOtros_K = d.otros_total * shareK;
        const fromOtros_S = d.otros_total * shareS;
        totK += d.k_base + fromOtros_K;
        totS += d.s_base + fromOtros_S;
      }
      return { totK, totS, ratio: totK / (totK + totS) };
    }

    // bisección para encontrar baseK
    let lo = 0.01, hi = 0.99;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const r = agregado(mid).ratio;
      if (r < targetRatio) lo = mid;
      else hi = mid;
    }
    z.baseK = (lo + hi) / 2;
    z.baseS = (1 - ABST_PROMEDIO) - z.baseK;
    z._achieved = agregado(z.baseK);
  }

  // Paso C: aplicar y armar output con todos los distritos calculados
  const distritos = [];
  for (const zonaKey of Object.keys(zonas)) {
    const z = zonas[zonaKey];
    for (const d of z.distritos) {
      const c = d.pct_castillo_1v_2021 ?? 19;
      const norm = z.max > z.min ? (c - z.min) / (z.max - z.min) : 0.5;
      const shareK = Math.max(0, z.baseK + (1 - 2 * norm) * SPREAD);
      const shareS = Math.max(0, (1 - ABST_PROMEDIO) - shareK);
      const shareAbst = Math.max(0, 1 - shareK - shareS);
      const fromOtros_K = d.otros_total * shareK;
      const fromOtros_S = d.otros_total * shareS;
      const abst = d.otros_total * shareAbst;
      const kProy = d.k_base + fromOtros_K;
      const sProy = d.s_base + fromOtros_S;
      const validos = kProy + sProy;
      distritos.push({
        ubigeo: d.ubigeo,
        departamento: d.departamento,
        provincia: d.provincia,
        distrito: d.distrito,
        zona: d.zona,
        validos_1v: d.validos_1v,
        keiko_base: Math.round(d.k_base),
        sanchez_base: Math.round(d.s_base),
        otros_1v: Math.round(d.otros_total),
        share_otros_a_K: +shareK.toFixed(4),
        share_otros_a_S: +shareS.toFixed(4),
        share_otros_abst: +shareAbst.toFixed(4),
        keiko_proy: Math.round(kProy),
        sanchez_proy: Math.round(sProy),
        abstencion_inducida: Math.round(abst),
        validos_proy: Math.round(validos),
        pct_keiko: +(kProy / validos * 100).toFixed(2),
        pct_sanchez: +(sProy / validos * 100).toFixed(2),
        margen: Math.round(kProy - sProy),
        ganador: kProy > sProy ? "K" : "S",
        pct_castillo_1v_2021: d.pct_castillo_1v_2021,
        pct_castillo_2v_2021: d.pct_castillo_2v_2021,
      });
    }
  }

  return { distritos, zonas };
}

// ============================================================
// ESCENARIOS ALTERNATIVOS (sensitividad: ¿qué pasa si cambian fundamentales?)
// ============================================================
//
// Ahora son perturbaciones del escenario ENCUESTAS:
//   - OPTIMISTA_K: rechazo K cae 8pp más → reasigna 8% del voto "abst" hacia K
//   - PESIMISTA_K: rechazo K sube 8pp → reasigna 8% del voto K-de-transferencia hacia "abst" o S
//
function aplicarPerturbacion(encuestas, perturbacion) {
  return encuestas.distritos.map(d => {
    let shareK = d.share_otros_a_K;
    let shareS = d.share_otros_a_S;
    let shareAbst = d.share_otros_abst;

    if (perturbacion === "OPTIMISTA_K") {
      // 60% del shareAbst y 30% del shareS pasa a K
      const moveFromAbst = shareAbst * 0.60;
      const moveFromS = shareS * 0.20;
      shareK += moveFromAbst + moveFromS;
      shareAbst -= moveFromAbst;
      shareS -= moveFromS;
    } else if (perturbacion === "PESIMISTA_K") {
      // 25% del shareK pasa a abst, 15% a S
      const moveToAbst = shareK * 0.25;
      const moveToS = shareK * 0.15;
      shareK -= moveToAbst + moveToS;
      shareAbst += moveToAbst;
      shareS += moveToS;
    }
    const fromOtros_K = d.otros_1v * shareK;
    const fromOtros_S = d.otros_1v * shareS;
    const abst = d.otros_1v * shareAbst;
    const kProy = d.keiko_base + fromOtros_K;
    const sProy = d.sanchez_base + fromOtros_S;
    const validos = kProy + sProy;

    return {
      ...d,
      share_otros_a_K: +shareK.toFixed(4),
      share_otros_a_S: +shareS.toFixed(4),
      share_otros_abst: +shareAbst.toFixed(4),
      keiko_proy: Math.round(kProy),
      sanchez_proy: Math.round(sProy),
      abstencion_inducida: Math.round(abst),
      validos_proy: Math.round(validos),
      pct_keiko: +(kProy / validos * 100).toFixed(2),
      pct_sanchez: +(sProy / validos * 100).toFixed(2),
      margen: Math.round(kProy - sProy),
      ganador: kProy > sProy ? "K" : "S",
    };
  });
}

function agregarProvinciaYDepartamento(distritos) {
  const provs = new Map();
  const deps = new Map();
  let nacK = 0, nacS = 0;
  for (const d of distritos) {
    const provKey = d.ubigeo.slice(0, 4);
    if (!provs.has(provKey)) {
      provs.set(provKey, { ubigeo: provKey, departamento: d.departamento, provincia: d.provincia, zona: d.zona, k: 0, s: 0, kBase: 0, sBase: 0, validos_1v: 0 });
    }
    const p = provs.get(provKey);
    p.k += d.keiko_proy; p.s += d.sanchez_proy;
    p.kBase += d.keiko_base; p.sBase += d.sanchez_base;
    p.validos_1v += d.validos_1v;

    if (!deps.has(d.departamento)) {
      deps.set(d.departamento, { departamento: d.departamento, k: 0, s: 0, validos_1v: 0 });
    }
    const x = deps.get(d.departamento);
    x.k += d.keiko_proy; x.s += d.sanchez_proy;
    x.validos_1v += d.validos_1v;

    nacK += d.keiko_proy;
    nacS += d.sanchez_proy;
  }
  const provincias = [];
  for (const p of provs.values()) {
    const val = p.k + p.s;
    provincias.push({
      ubigeo: p.ubigeo,
      departamento: p.departamento,
      provincia: p.provincia,
      zona: p.zona,
      validos_1v: p.validos_1v,
      keiko_base: Math.round(p.kBase),
      sanchez_base: Math.round(p.sBase),
      keiko_proy: Math.round(p.k),
      sanchez_proy: Math.round(p.s),
      validos_proy: Math.round(val),
      pct_keiko: +(p.k / val * 100).toFixed(2),
      pct_sanchez: +(p.s / val * 100).toFixed(2),
      margen: Math.round(p.k - p.s),
      ganador: p.k > p.s ? "K" : "S",
    });
  }
  const departamentos = [];
  for (const d of deps.values()) {
    const val = d.k + d.s;
    departamentos.push({
      departamento: d.departamento,
      validos_1v: d.validos_1v,
      keiko_proy: Math.round(d.k),
      sanchez_proy: Math.round(d.s),
      pct_keiko: +(d.k / val * 100).toFixed(2),
      pct_sanchez: +(d.s / val * 100).toFixed(2),
      margen: Math.round(d.k - d.s),
      ganador: d.k > d.s ? "K" : "S",
    });
  }
  const validosNac = nacK + nacS;
  return {
    nacional: {
      keiko: Math.round(nacK),
      sanchez: Math.round(nacS),
      validos: Math.round(validosNac),
      pct_keiko: +(nacK / validosNac * 100).toFixed(3),
      pct_sanchez: +(nacS / validosNac * 100).toFixed(3),
      margen: Math.round(nacK - nacS),
      ganador: nacK > nacS ? "Keiko" : "Sánchez",
    },
    provincias,
    departamentos,
  };
}

// ============================================================
// EJECUCIÓN
// ============================================================
const out = {
  meta: {
    generated_at: new Date().toISOString(),
    granularidad: "distrito (1,892 unidades)",
    fuentes_encuestas: {
      ipsos_abr_23_24: { k: 38, s: 38, blanco_nulo: 17, ns: 7, val_k: 50, val_s: 50, rechazo_k: 48, rechazo_s: 43 },
      iep_abr_21_25:   { k: 31, s: 32, blanco_nulo: 24, ns: 13, val_k: 49.2, val_s: 50.8, muestra: 1207, error_pp: 2.8 },
      iep_regionales:  TARGET_VAL_IEP,
      iep_nse: {
        keiko: { ab: 51, c: 36, de: 22 },
        sanchez: { ab: 20, c: 28, de: 38 },
      },
    },
    transferencias_calibradas: {},
    notas: [
      "Modelo calibrado contra encuestas IPSOS (23-24 abril 2026) e IEP (21-25 abril 2026).",
      "Sánchez se autodefine como 'candidato castillista' (ex-ministro Castillo) → captura el voto Castillo casi 1:1 en zonas donde Castillo arrasó.",
      "Mapeo dep → zona IEP. Lima Metro / Costa Norte / Costa Sur / Sierra Centro / Sierra Sur / Oriente.",
      "Dentro de cada zona, voto 'otros' se distribuye por % Castillo 1V 2021 distrital (spread 0.25).",
      "Tasa de abstención inducida (~30% del voto 'otros') refleja 17-24% blanco/nulo medido en encuestas.",
    ],
  },
  escenarios: {},
};

// 1V nacional
const totV1 = data.nacional.candidatos.reduce((a, c) => a + (c.totalVotosValidos || 0), 0);
const kV1 = data.nacional.candidatos.find(c => c.nombreCandidato === K_NAME)?.totalVotosValidos || 0;
const sV1 = data.nacional.candidatos.find(c => c.nombreCandidato === S_NAME)?.totalVotosValidos || 0;
out.meta.nacional_1v = {
  keiko: kV1, sanchez: sV1, otros: totV1 - kV1 - sV1, validos: totV1,
  pct_keiko: +(kV1 / totV1 * 100).toFixed(2),
  pct_sanchez: +(sV1 / totV1 * 100).toFixed(2),
};

// Escenario ENCUESTAS (primario)
const enc = correrEncuestas();
out.escenarios.ENCUESTAS = {
  label: "Encuestas (anclado a IPSOS+IEP abr-2026)",
  ...agregarProvinciaYDepartamento(enc.distritos),
  distritos: enc.distritos,
  calibracion: Object.fromEntries(Object.entries(enc.zonas).map(([k, v]) => [k, {
    base_share_K: +v.baseK.toFixed(4),
    base_share_S: +v.baseS.toFixed(4),
    achieved_pctK: +(v._achieved.totK / (v._achieved.totK + v._achieved.totS) * 100).toFixed(2),
    target_pctK: TARGET_VAL_IEP[k]?.k ?? null,
    n_distritos: v.distritos.length,
  }])),
};

// Sensibilidades
const opt = aplicarPerturbacion({ distritos: enc.distritos }, "OPTIMISTA_K");
out.escenarios.OPTIMISTA_K = {
  label: "Optimista K (rechazo K cae 8pp más: 60% abst + 20% S → K)",
  ...agregarProvinciaYDepartamento(opt),
  distritos: opt,
};
const pes = aplicarPerturbacion({ distritos: enc.distritos }, "PESIMISTA_K");
out.escenarios.PESIMISTA_K = {
  label: "Pesimista K (rechazo K rebrota: 25% de K → abst, 15% K → S)",
  ...agregarProvinciaYDepartamento(pes),
  distritos: pes,
};

// ===== Provincias bisagra (margen <8pp en escenario ENCUESTAS) =====
out.bisagra = enc.distritos
  .filter(d => Math.abs(d.pct_keiko - 50) < 8 && d.validos_proy > 3000)
  .sort((a, b) => Math.abs(a.pct_keiko - 50) - Math.abs(b.pct_keiko - 50))
  .slice(0, 40)
  .map(d => ({
    ubigeo: d.ubigeo,
    departamento: d.departamento,
    provincia: d.provincia,
    distrito: d.distrito,
    zona: d.zona,
    validos_proy: d.validos_proy,
    pct_keiko_encuestas: d.pct_keiko,
    pct_keiko_optimista: opt.find(x => x.ubigeo === d.ubigeo)?.pct_keiko,
    pct_keiko_pesimista: pes.find(x => x.ubigeo === d.ubigeo)?.pct_keiko,
    pct_castillo_1v_2021: d.pct_castillo_1v_2021,
  }));

// ===== Umbrales: cuánto puede caer Keiko en cada provincia bajo PESIMISTA =====
const pessProv = out.escenarios.PESIMISTA_K.provincias;
const margenPess = out.escenarios.PESIMISTA_K.nacional.margen;
const colchon = Math.max(0, margenPess / 2);
out.umbrales_keiko = [];
for (const p of pessProv) {
  if (p.validos_proy === 0) continue;
  const buffer = colchon / p.validos_proy * 100;
  out.umbrales_keiko.push({
    ubigeo: p.ubigeo,
    departamento: p.departamento,
    provincia: p.provincia,
    validos_proy: p.validos_proy,
    pct_actual_pesimista: p.pct_keiko,
    pct_minimo_keiko: +(p.pct_keiko - buffer).toFixed(2),
    buffer_pp: +buffer.toFixed(2),
    es_provincia_keiko: p.pct_keiko > 50,
    ganador_pesimista: p.ganador,
  });
}
out.umbrales_keiko.sort((a, b) => a.buffer_pp - b.buffer_pp);

fs.writeFileSync("segunda_vuelta_2026.json", JSON.stringify(out, null, 2));

// ===== Consola =====
console.log("=".repeat(80));
console.log("MODELO 2DA VUELTA 2026 — CALIBRADO CON ENCUESTAS REALES IPSOS+IEP");
console.log("=".repeat(80));
console.log(`\n1V Nacional: K=${out.meta.nacional_1v.pct_keiko}% / S=${out.meta.nacional_1v.pct_sanchez}% / Otros=${(out.meta.nacional_1v.otros/totV1*100).toFixed(1)}%`);
console.log("\nCalibración por zona IEP (escenario ENCUESTAS):");
for (const [zona, c] of Object.entries(out.escenarios.ENCUESTAS.calibracion)) {
  console.log(`  ${zona.padEnd(15)} baseK=${c.base_share_K}  baseS=${c.base_share_S}  target=${c.target_pctK}%  achieved=${c.achieved_pctK}%  (${c.n_distritos} distritos)`);
}
console.log("\nResultados nacionales por escenario:");
for (const [name, esc] of Object.entries(out.escenarios)) {
  const n = esc.nacional;
  console.log(`  ${name.padEnd(15)} K=${String(n.pct_keiko).padStart(6)}% S=${String(n.pct_sanchez).padStart(6)}% margen=${n.margen.toLocaleString().padStart(11)} → ${n.ganador}`);
}
console.log("\nDepartamentos (escenario ENCUESTAS) — top:");
out.escenarios.ENCUESTAS.departamentos.sort((a,b) => b.pct_keiko - a.pct_keiko).forEach(d => {
  console.log(`  ${d.departamento.padEnd(20)} K=${String(d.pct_keiko).padStart(5)}% S=${String(d.pct_sanchez).padStart(5)}% margen=${d.margen.toLocaleString().padStart(10)} → ${d.ganador}`);
});

console.log("\nProvincias K más vulnerables bajo PESIMISTA:");
out.umbrales_keiko.filter(u => u.es_provincia_keiko).slice(0, 8).forEach(u => {
  console.log(`  ${u.provincia.padEnd(20)} ${u.departamento.padEnd(15)} %K_act=${String(u.pct_actual_pesimista).padStart(5)} buffer=${String(u.buffer_pp).padStart(6)}pp validos=${u.validos_proy.toLocaleString()}`);
});

console.log(`\n✅ Escribió segunda_vuelta_2026.json (${(fs.statSync("segunda_vuelta_2026.json").size/1024).toFixed(0)}KB)`);
