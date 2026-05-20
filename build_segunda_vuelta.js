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
const { execSync } = require("child_process");
const { analizarPolls } = require("./polls_engine");

// Regenera el modelo predictivo primero
try { execSync("node build_predictive.js", { stdio: "pipe" }); } catch (e) {}

const data = require("./data.json");
const forense2v = require("./forensic_2021_provincias.json");      // 2V 2021
const forense1v = require("./forensic_2021_1v_distritos.json");    // 1V 2021
const modelPred = require("./modelo_predictivo_2026.json");        // modelo agnóstico propio

// Timeseries de encuestas + momentum + tripwires (calculado del polls.json)
const pollsAnalysis = analizarPolls("./polls.json");

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

// ============================================================
// ESCENARIO MAS_PROBABLE — integra encuestas + todas las señales
// ============================================================
//
// Ajustes sobre ENCUESTAS para reflejar lo que sabemos del 16-may (3 semanas a la votación):
//
//   1. Momentum antivoto K: cayó 11pp en 3 semanas (59% → 48%).
//      Si sigue a la mitad de esa velocidad: -3pp más en 3 semanas → favorece K ~+1.5pp
//      Pero los modelos de antivoto suelen estabilizarse al acercarse el día D.
//      Net: +1.0pp K
//
//   2. Anti-momentum recta final (efecto 2016): el antifujimorismo histórico se moviliza
//      en la última semana. En 2016 Keiko cayó 10pp en 2 semanas (de Keiko+10 a PPK+0.25).
//      No será tan brutal porque rechazo S también subió, pero hay riesgo.
//      Net: -1.5pp K
//
//   3. Voto extranjero: ~500K votos exterior, en 2V 2026 entre K vs S, perfil urbano
//      educado fuera del país → ~72% K (vs 50/50 asumido en ENCUESTAS).
//      Diferencia: 500K * (0.72 - 0.50) = +110K margen a K = +0.7pp nacional
//
//   4. Voto del miedo a Castillo 2.0: Sánchez se autodefine castillista. Una parte
//      del centro/centro-izq que en encuestas dice "blanco/nulo" termina votando K
//      por miedo a régimen castillista en el día D.
//      Net: +0.5pp K
//
//   Total ajuste neto: +0.7pp K sobre ENCUESTAS (50.80% → ~51.5%)
//
// Estos números están redondeados y son mi mejor estimación. La incertidumbre real
// se mide via Monte Carlo más abajo.

function aplicarMasProbable(encDistritos) {
  // Ajustes globales (sobre share_otros, no shift directo del %K)
  const SHIFT_MOMENTUM_ANTIVOTO_K = +0.010;   // +1pp K
  const SHIFT_RECTA_FINAL_2016    = -0.015;   // -1.5pp K (efecto histórico)
  const SHIFT_MIEDO_CASTILLO_20   = +0.005;   // +0.5pp K (voto del miedo)
  // Voto extranjero se aplica como overlay a distritos con dep=EXTRANJERO

  const NET_SHIFT_NACIONAL = SHIFT_MOMENTUM_ANTIVOTO_K + SHIFT_RECTA_FINAL_2016 + SHIFT_MIEDO_CASTILLO_20;
  // = 0.000 (se cancelan en promedio). Pero NO se cancelan por distrito por la dirección.

  // Implementación: el net shift se reparte como un % de "otros" desde abst+S hacia K.
  // Por simpleza, lo aplicamos como una transferencia del share_S al share_K en cada distrito.
  return encDistritos.map(d => {
    let shareK = d.share_otros_a_K;
    let shareS = d.share_otros_a_S;
    let shareAbst = d.share_otros_abst;

    // Aplicar net shift: si net positivo → muevo de abst hacia K. Si negativo → de K hacia abst.
    if (NET_SHIFT_NACIONAL > 0) {
      const mv = Math.min(shareAbst, NET_SHIFT_NACIONAL * 2.5); // factor 2.5 porque shift es nacional sobre 1.0 ≈ 70% del electorado
      shareK += mv;
      shareAbst -= mv;
    } else if (NET_SHIFT_NACIONAL < 0) {
      const mv = Math.min(shareK, -NET_SHIFT_NACIONAL * 2.5);
      shareK -= mv;
      shareAbst += mv;
    }

    // Voto extranjero: si dep = EXTRANJERO, override con 72% K / 28% S
    const isExtranjero = d.departamento === "EXTRANJERO";

    const fromOtros_K = d.otros_1v * shareK;
    const fromOtros_S = d.otros_1v * shareS;
    const abst = d.otros_1v * shareAbst;
    let kProy = d.keiko_base + fromOtros_K;
    let sProy = d.sanchez_base + fromOtros_S;

    if (isExtranjero) {
      // Override: total válido proyectado se asigna 72/28
      const validosExt = kProy + sProy;
      kProy = validosExt * 0.72;
      sProy = validosExt * 0.28;
    }

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

// ============================================================
// MONTE CARLO — distribución de probabilidad
// ============================================================
//
// Modelo: cada simulación perturba 4 parámetros con ruido normal y calcula resultado nacional.
//   ε1 = shift_antivoto_3sem  ~ Normal(0,    σ=0.015)   incertidumbre tendencia antivoto
//   ε2 = shock_late_camp      ~ Normal(-0.005, σ=0.012) efecto recta final (sesgo histórico)
//   ε3 = voto_ext_K           ~ Normal(0.72, σ=0.05)    voto extranjero
//   ε4 = correlacion_zonal    ~ Normal(0,    σ=0.020)   ruido por zona IEP
//
// 5000 corridas. Output: P(K gana), mediana K%, CI80, CI95.

function gaussian(mu = 0, sigma = 1) {
  // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mu + sigma * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function correrMonteCarlo(encDistritos, nSims = 5000) {
  const results = [];
  for (let i = 0; i < nSims; i++) {
    const e1 = gaussian(0, 0.015);
    const e2 = gaussian(-0.005, 0.012);
    const e3 = gaussian(0.72, 0.05);
    const e4_byZone = {
      LIMA_METRO: gaussian(0, 0.020),
      COSTA_NORTE: gaussian(0, 0.020),
      COSTA_SUR: gaussian(0, 0.020),
      SIERRA_CENTRO: gaussian(0, 0.020),
      SIERRA_SUR: gaussian(0, 0.020),
      ORIENTE: gaussian(0, 0.020),
    };
    const shiftGlobal = e1 + e2 + 0.005; // +0.5pp miedo Castillo fijo

    let totK = 0, totS = 0;
    for (const d of encDistritos) {
      let sK = d.share_otros_a_K;
      let sS = d.share_otros_a_S;
      let sA = d.share_otros_abst;

      // Aplicar shift global (desde abst a K si positivo)
      const totalShift = shiftGlobal * 2.5 + (e4_byZone[d.zona] || 0) * 2.0;
      if (totalShift > 0) {
        const mv = Math.min(sA, totalShift);
        sK += mv; sA -= mv;
      } else if (totalShift < 0) {
        const mv = Math.min(sK, -totalShift);
        sK -= mv; sA += mv;
      }
      sK = Math.max(0, Math.min(1, sK));
      sS = Math.max(0, Math.min(1, sS));

      let kProy = d.keiko_base + d.otros_1v * sK;
      let sProy = d.sanchez_base + d.otros_1v * sS;

      if (d.departamento === "EXTRANJERO") {
        const v = kProy + sProy;
        kProy = v * e3;
        sProy = v * (1 - e3);
      }
      totK += kProy;
      totS += sProy;
    }
    const pctK = totK / (totK + totS) * 100;
    results.push(pctK);
  }
  results.sort((a, b) => a - b);
  const median = results[Math.floor(nSims * 0.5)];
  const p10 = results[Math.floor(nSims * 0.10)];
  const p90 = results[Math.floor(nSims * 0.90)];
  const p025 = results[Math.floor(nSims * 0.025)];
  const p975 = results[Math.floor(nSims * 0.975)];
  const pKwins = results.filter(r => r > 50).length / nSims * 100;
  return {
    n_sims: nSims,
    mediana_pct_keiko: +median.toFixed(2),
    mediana_pct_sanchez: +(100 - median).toFixed(2),
    prob_keiko_gana: +pKwins.toFixed(1),
    prob_sanchez_gana: +(100 - pKwins).toFixed(1),
    ci80_keiko: [+p10.toFixed(2), +p90.toFixed(2)],
    ci95_keiko: [+p025.toFixed(2), +p975.toFixed(2)],
    parametros: {
      momentum_antivoto_k: { mu: 0, sigma: 0.015 },
      late_campaign_2016_effect: { mu: -0.005, sigma: 0.012 },
      voto_extranjero_k: { mu: 0.72, sigma: 0.05 },
      ruido_zonal: { mu: 0, sigma: 0.020 },
      shift_miedo_castillo: 0.005,
    },
  };
}

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

// ============================================================
// MODELO_PROPIO — predicción agnóstica de encuestas
// ============================================================
//
// Resultado del modelo predictivo distrital (build_predictive.js):
// continuity_factor × ajuste_castillo_personal × ajuste_urbano + antivoto K + efecto 2016
// Da: K ~52% / S ~48% (5pp diferente a IEP)
//
// Lo integro como escenario MODELO_PROPIO con todas sus métricas.

const modelPredMap = new Map();
modelPred.distritos.forEach(d => modelPredMap.set(d.ubigeo, d));

function distritosFromModelPred() {
  // Adaptar formato del modelo predictivo al formato esperado
  return modelPred.distritos.map(d => ({
    ubigeo: d.ubigeo,
    departamento: d.departamento,
    provincia: d.provincia,
    distrito: d.distrito,
    zona: distritoZona(d.departamento),
    validos_1v: 0,
    keiko_base: 0,
    sanchez_base: 0,
    otros_1v: 0,
    share_otros_a_K: 0,
    share_otros_a_S: 0,
    share_otros_abst: 0,
    keiko_proy: d.votos_keiko_pred,
    sanchez_proy: d.votos_sanchez_pred,
    abstencion_inducida: 0,
    validos_proy: d.votos_keiko_pred + d.votos_sanchez_pred,
    pct_keiko: d.pct_keiko_pred,
    pct_sanchez: d.pct_sanchez_pred,
    margen: d.margen_pred,
    ganador: d.ganador_pred,
    pct_castillo_1v_2021: null,
    pct_castillo_2v_2021: d.pct_castillo_2V_2021,
    continuity_factor: d.continuity_factor,
    ajuste_castillo_personal: d.ajuste_castillo_personal,
    ajuste_urbano: d.ajuste_urbano,
  }));
}

const modeloPropioDist = distritosFromModelPred();
out.escenarios.MODELO_PROPIO = {
  label: `Modelo propio agnóstico (back-test RMSE ${modelPred.meta.back_test_rmse}pp)`,
  ...agregarProvinciaYDepartamento(modeloPropioDist),
  distritos: modeloPropioDist,
  metodologia: modelPred.meta.metodologia,
  validacion: modelPred.meta.validacion_cruzada,
  validacion_zonal: modelPred.validacion_zonal,
};

// ============================================================
// MAS_PROBABLE — Bayesian blend 3-way (modelo + encuestas + Polymarket)
// ============================================================
//
// Polymarket actualizado 18-may 2026:
//   Keiko 64¢ / Sánchez 34.7¢ ($52.9M volumen total)
//   Esto NO es % de voto — es probabilidad de ganar.
//   Convertir a "% K esperado": si P(K gana) = 64%, entonces el resultado medio condicional
//   en victoria de K es ~51-52% (margen apretado); el medio condicional Sánchez victoria es ~49%.
//   Voto esperado K = 0.64 × 51.5 + 0.36 × 48.5 ≈ 50.4%.
//   Esto es nuestro "Polymarket implícito %K".
const POLYMARKET_P_K = 0.64;
const POLYMARKET_VOL_USD = 52946762;
const POLYMARKET_PCT_K_IMPLIED = POLYMARKET_P_K * 51.5 + (1 - POLYMARKET_P_K) * 48.5; // ≈ 50.4%

// Pesos del blend bayesiano (suman 1.0):
const W_MODELO = 0.30;       // modelo propio (RMSE 11pp por distrito, alto)
const W_ENCUESTAS = 0.45;    // encuestas IEP/IPSOS (±2.8pp error muestral, mayor metodología)
const W_POLYMARKET = 0.25;   // smart money con skin in the game ($53M apostado)

const encDistMap = new Map();
enc.distritos.forEach(d => encDistMap.set(d.ubigeo, d));

// Polymarket no tiene granularidad distrital. Aplicamos un shift uniforme nacional
// para llevar el agregado del blend modelo+encuestas hacia POLYMARKET_PCT_K_IMPLIED.

// Primero blend modelo+encuestas sin Polymarket para saber su agregado nacional
let totK_modEnc = 0, totS_modEnc = 0;
const blendModEnc = [];
for (const dMP of modeloPropioDist) {
  const dEnc = encDistMap.get(dMP.ubigeo);
  if (!dEnc) { blendModEnc.push({ ...dMP }); continue; }
  const w_mod_norm = W_MODELO / (W_MODELO + W_ENCUESTAS);
  const w_enc_norm = W_ENCUESTAS / (W_MODELO + W_ENCUESTAS);
  const pct_K_blend = dMP.pct_keiko * w_mod_norm + dEnc.pct_keiko * w_enc_norm;
  const validos = Math.max(dMP.validos_proy, dEnc.validos_proy);
  blendModEnc.push({ ...dEnc, pct_keiko: pct_K_blend, validos_proy: validos });
  totK_modEnc += validos * pct_K_blend / 100;
  totS_modEnc += validos * (100 - pct_K_blend) / 100;
}
const pct_K_modEnc_nac = totK_modEnc / (totK_modEnc + totS_modEnc) * 100;

// Shift necesario para alcanzar la mezcla 3-way: pct_K_final = (1-Wpoly)*pct_K_modEnc + Wpoly*POLYMARKET
const target_K_nac = (W_MODELO + W_ENCUESTAS) * pct_K_modEnc_nac + W_POLYMARKET * POLYMARKET_PCT_K_IMPLIED;
const SHIFT_POLYMARKET_PP = target_K_nac - pct_K_modEnc_nac;
console.log(`Blend mod+enc nacional: K ${pct_K_modEnc_nac.toFixed(2)}% · target final con polymarket: ${target_K_nac.toFixed(2)}% · shift: ${SHIFT_POLYMARKET_PP.toFixed(2)}pp`);

// Aplicar shift uniforme a cada distrito
const mpDist = [];
for (const d of blendModEnc) {
  const pct_K_final = d.pct_keiko + SHIFT_POLYMARKET_PP;
  const pct_S_final = 100 - pct_K_final;
  const validos = d.validos_proy;
  const votos_K = Math.round(validos * pct_K_final / 100);
  const votos_S = Math.round(validos * pct_S_final / 100);
  const dMP_for_log = modeloPropioDist.find(x => x.ubigeo === d.ubigeo);
  const dEnc_for_log = encDistMap.get(d.ubigeo);
  mpDist.push({
    ...d,
    keiko_proy: votos_K,
    sanchez_proy: votos_S,
    validos_proy: votos_K + votos_S,
    pct_keiko: +pct_K_final.toFixed(2),
    pct_sanchez: +pct_S_final.toFixed(2),
    margen: votos_K - votos_S,
    ganador: votos_K > votos_S ? "K" : "S",
    blend_modelo_pct_k: dMP_for_log?.pct_keiko,
    blend_encuestas_pct_k: dEnc_for_log?.pct_keiko,
    blend_polymarket_shift_pp: +SHIFT_POLYMARKET_PP.toFixed(2),
  });
}

out.escenarios.MAS_PROBABLE = {
  label: `Más probable (blend 3-way: 30% modelo + 45% encuestas + 25% Polymarket)`,
  ...agregarProvinciaYDepartamento(mpDist),
  distritos: mpDist,
  blend: {
    pesos: { modelo_propio: W_MODELO, encuestas: W_ENCUESTAS, polymarket: W_POLYMARKET },
    polymarket: {
      prob_keiko_gana: POLYMARKET_P_K,
      pct_k_implied: +POLYMARKET_PCT_K_IMPLIED.toFixed(2),
      volumen_usd: POLYMARKET_VOL_USD,
      url: "https://polymarket.com/event/peru-presidential-election-winner",
    },
    justificacion: "Blend 3-way ponderado: 30% modelo distrital (RMSE 11pp pero captura tendencias estructurales); 45% encuestas IEP/IPSOS (±2.8pp pero metodología validada); 25% Polymarket (smart money $53M apostado, free of polling biases).",
  },
};

// ============================================================
// ESCENARIO MOMENTUM — extrapola velocidades IPSOS al día D
// ============================================================
//
// Toma el escenario ENCUESTAS como base distrital y aplica un shift uniforme
// para que el % nacional iguale el momentum proyectado del polls_engine.
// El momentum_engine ya computó el % nacional válido proyectado al 7-jun
// usando velocidades observadas IPSOS (abr→may) con dampening 0.5
// y reparto del limbo con prior histórico Perú 2da vuelta.

if (pollsAnalysis.escenario_momentum) {
  const targetMomentumK = pollsAnalysis.escenario_momentum.nacional_valido.k;
  const baseEncNac = out.escenarios.ENCUESTAS.nacional;
  const baseEncK = baseEncNac.pct_keiko;
  const SHIFT_MOMENTUM_PP = targetMomentumK - baseEncK;

  const momentumDist = enc.distritos.map(d => {
    const pct_K = Math.max(3, Math.min(97, d.pct_keiko + SHIFT_MOMENTUM_PP));
    const pct_S = 100 - pct_K;
    const validos = d.validos_proy;
    const k = Math.round(validos * pct_K / 100);
    const s = Math.round(validos * pct_S / 100);
    return {
      ...d,
      keiko_proy: k,
      sanchez_proy: s,
      validos_proy: k + s,
      pct_keiko: +pct_K.toFixed(2),
      pct_sanchez: +pct_S.toFixed(2),
      margen: k - s,
      ganador: k > s ? "K" : "S",
    };
  });
  out.escenarios.MOMENTUM = {
    label: `Momentum (extrapola velocidades IPSOS abr→may al día D, dampening 0.5)`,
    ...agregarProvinciaYDepartamento(momentumDist),
    distritos: momentumDist,
    momentum: pollsAnalysis.escenario_momentum,
    shift_aplicado_pp: +SHIFT_MOMENTUM_PP.toFixed(2),
    justificacion: "Toma la última IPSOS (16-17 may) por estrato (Lima/Otras/Rural), extrapola con velocidad observada de 3 semanas previas (con 50% dampening porque tendencias se aplanan cerca del día D), reparte el limbo (indec+B/N) con prior histórico Perú: 55% al líder, 30% al rezagado, 15% nulo extra; +10% al líder si el rezagado es percibido radical (sesgo anti-castillista observado en 2021).",
  };
  console.log(`Momentum nacional: K ${targetMomentumK}% (shift sobre ENCUESTAS: ${SHIFT_MOMENTUM_PP > 0 ? '+' : ''}${SHIFT_MOMENTUM_PP.toFixed(2)}pp)`);
}

// Adjuntar análisis del timeseries (polls_engine) al output
out.polls_timeseries = pollsAnalysis;

// Monte Carlo — distribución de probabilidad
// Usamos los distritos MAS_PROBABLE (blend) como ancla
// y agregamos ruido representando:
//  - Incertidumbre en el peso del blend (¿más cerca del modelo o encuestas?) σ=0.10
//  - Shock recta final 2016 (riesgo) μ=-0.5pp σ=1.2pp K
//  - Antivoto K trajectory σ=1.5pp K
//  - Voto extranjero σ=0.05
//  - Ruido zonal σ=2.0pp por zona

function correrMonteCarlo2(blendDistritos, modelDistMap, encDistMap, nSims = 5000) {
  const results = [];
  for (let i = 0; i < nSims; i++) {
    const e1 = gaussian(0, 0.015);          // shift global antivoto
    const e2 = gaussian(-0.005, 0.012);     // recta final 2016
    const e3 = gaussian(0.72, 0.05);        // voto extranjero
    const wMod = clampNum(gaussian(0.45, 0.10), 0.20, 0.70);  // peso modelo vs encuestas
    const wEnc = 1 - wMod;
    const e_zonal = {
      LIMA_METRO: gaussian(0, 0.020), COSTA_NORTE: gaussian(0, 0.020),
      COSTA_SUR: gaussian(0, 0.020), SIERRA_CENTRO: gaussian(0, 0.020),
      SIERRA_SUR: gaussian(0, 0.020), ORIENTE: gaussian(0, 0.020),
    };

    let totK = 0, totS = 0;
    for (const d of blendDistritos) {
      const dMod = modelDistMap.get(d.ubigeo);
      const dEnc = encDistMap.get(d.ubigeo);
      if (!dMod || !dEnc) continue;

      // Blend con peso muestral
      let pctK = dMod.pct_keiko * wMod + dEnc.pct_keiko * wEnc;
      // Ajustes globales sobre el blend
      pctK += (e1 + e2 + 0.005) * 100;
      pctK += (e_zonal[d.zona] || 0) * 100;
      pctK = clampNum(pctK, 3, 97);

      const validos = d.validos_proy;
      let kProy = validos * pctK / 100;
      let sProy = validos - kProy;

      if (d.departamento === "EXTRANJERO") {
        kProy = validos * e3;
        sProy = validos * (1 - e3);
      }
      totK += kProy;
      totS += sProy;
    }
    results.push(totK / (totK + totS) * 100);
  }
  results.sort((a, b) => a - b);
  const median = results[Math.floor(nSims * 0.5)];
  const p10 = results[Math.floor(nSims * 0.10)];
  const p90 = results[Math.floor(nSims * 0.90)];
  const p025 = results[Math.floor(nSims * 0.025)];
  const p975 = results[Math.floor(nSims * 0.975)];
  const pKwins = results.filter(r => r > 50).length / nSims * 100;
  return {
    n_sims: nSims,
    mediana_pct_keiko: +median.toFixed(2),
    mediana_pct_sanchez: +(100 - median).toFixed(2),
    prob_keiko_gana: +pKwins.toFixed(1),
    prob_sanchez_gana: +(100 - pKwins).toFixed(1),
    ci80_keiko: [+p10.toFixed(2), +p90.toFixed(2)],
    ci95_keiko: [+p025.toFixed(2), +p975.toFixed(2)],
    parametros: {
      blend_modelo_propio: { mu: 0.45, sigma: 0.10 },
      shift_antivoto_3sem: { mu: 0, sigma: 0.015 },
      recta_final_2016: { mu: -0.005, sigma: 0.012 },
      voto_extranjero_k: { mu: 0.72, sigma: 0.05 },
      ruido_zonal: { mu: 0, sigma: 0.020 },
    },
  };
}

function clampNum(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

const modelDistMapForMC = new Map();
modeloPropioDist.forEach(d => modelDistMapForMC.set(d.ubigeo, d));

console.log("Corriendo Monte Carlo 5,000 simulaciones (modelo + encuestas con incertidumbre en blend)...");
out.monte_carlo = correrMonteCarlo2(mpDist, modelDistMapForMC, encDistMap, 5000);

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

console.log("\nMonte Carlo (5,000 sims):");
console.log(`  mediana K: ${out.monte_carlo.mediana_pct_keiko}%   mediana S: ${out.monte_carlo.mediana_pct_sanchez}%`);
console.log(`  P(Keiko gana): ${out.monte_carlo.prob_keiko_gana}%`);
console.log(`  P(Sánchez gana): ${out.monte_carlo.prob_sanchez_gana}%`);
console.log(`  CI 80% Keiko: [${out.monte_carlo.ci80_keiko[0]}%, ${out.monte_carlo.ci80_keiko[1]}%]`);
console.log(`  CI 95% Keiko: [${out.monte_carlo.ci95_keiko[0]}%, ${out.monte_carlo.ci95_keiko[1]}%]`);
console.log("\nDepartamentos (escenario ENCUESTAS) — top:");
out.escenarios.ENCUESTAS.departamentos.sort((a,b) => b.pct_keiko - a.pct_keiko).forEach(d => {
  console.log(`  ${d.departamento.padEnd(20)} K=${String(d.pct_keiko).padStart(5)}% S=${String(d.pct_sanchez).padStart(5)}% margen=${d.margen.toLocaleString().padStart(10)} → ${d.ganador}`);
});

console.log("\nProvincias K más vulnerables bajo PESIMISTA:");
out.umbrales_keiko.filter(u => u.es_provincia_keiko).slice(0, 8).forEach(u => {
  console.log(`  ${u.provincia.padEnd(20)} ${u.departamento.padEnd(15)} %K_act=${String(u.pct_actual_pesimista).padStart(5)} buffer=${String(u.buffer_pp).padStart(6)}pp validos=${u.validos_proy.toLocaleString()}`);
});

console.log(`\n✅ Escribió segunda_vuelta_2026.json (${(fs.statSync("segunda_vuelta_2026.json").size/1024).toFixed(0)}KB)`);
