/**
 * POLLS ENGINE — análisis del timeseries polls.json
 *
 * Calcula a partir del histórico de encuestas:
 *   1. Velocidades (pp/semana) por estrato y por candidato
 *   2. Reparto del limbo (indecisos + blanco/nulo) con prior histórico Perú 2da vuelta
 *   3. Escenario MOMENTUM: extrapola velocidades al día de elección
 *   4. Tripwires (3 semáforos): antivoto K, rural Sánchez, indecisos
 *
 * NO depende de granularidad distrital — opera solo sobre agregados nacionales/estrato.
 * El output se inyecta en segunda_vuelta_2026.json para que el dashboard lo renderice.
 */

const fs = require("fs");

const DIA_ELECCION = "2026-06-07";

// ============================================================
// PRIOR HISTÓRICO — reparto del limbo (indecisos + blanco/nulo)
// ============================================================
//
// En 2da vuelta Perú, parte del "limbo" termina votando, parte queda nulo.
// 2016: limbo encuesta final 14-18% → blanco/nulo real ~9.4%. Diferencia se repartió.
// 2021: limbo encuesta final 22-25% → blanco/nulo real 18.6%. Polarización extrema.
// 2026: contexto intermedio — Sánchez es castillista pero más moderado que Castillo.
//
// Asumimos: ~13% del electorado termina blanco/nulo el día D. Lo demás del limbo se reparte:
//   - 50% al líder en encuestas (efecto "subirse al carro")
//   - 35% al rezagado (correctivo último momento)
//   - 15% queda en nulo además del piso 13%
//
// Cuando el rezagado es castillista, históricamente el reparto se SESGA al líder anti-castillista:
// en 2021 Castillo perdió votos en última semana → ese sesgo se modela con un asym_factor.
const PISO_BLANCO_NULO = 0.13;         // 13% nulo estructural día D
const REPARTO_LIDER = 0.55;            // del exceso de limbo
const REPARTO_REZAGADO = 0.30;
const REPARTO_NULO_EXTRA = 0.15;
const ASYM_SI_REZAGADO_RADICAL = 0.10; // shift adicional al líder si el rezagado es percibido radical

// ============================================================
// UTILIDADES
// ============================================================

function diasEntre(d1, d2) {
  return (new Date(d2) - new Date(d1)) / (1000 * 60 * 60 * 24);
}

function midDate(start, end) {
  return new Date((new Date(start).getTime() + new Date(end).getTime()) / 2);
}

function fechaEfectiva(poll) {
  // Punto medio del trabajo de campo
  return midDate(poll.fecha_campo[0], poll.fecha_campo[1]);
}

// ============================================================
// VELOCIDADES POR ESTRATO
// ============================================================
//
// Toma todas las encuestas del MISMO pollster (para evitar house effect), las ordena,
// y calcula pp/semana por estrato para K, S y blanco_nulo.
// Devuelve velocidades + intervalos de tiempo usados.

function calcularVelocidades(polls) {
  // Solo encuestas IPSOS con estratos lima/otras/rural (la única serie comparable)
  const series = polls
    .filter(p => p.pollster === "IPSOS" && p.resultados.estratos?.lima_metro)
    .sort((a, b) => fechaEfectiva(a) - fechaEfectiva(b));

  if (series.length < 2) {
    return { velocidades: null, motivo: "Necesita ≥2 encuestas IPSOS con estratos", n_polls: series.length };
  }

  const primero = series[0];
  const ultimo = series[series.length - 1];
  const dias = diasEntre(fechaEfectiva(primero), fechaEfectiva(ultimo));
  const semanas = dias / 7;

  function delta(estrato, campo) {
    const v1 = primero.resultados.estratos[estrato]?.[campo];
    const v2 = ultimo.resultados.estratos[estrato]?.[campo];
    if (v1 == null || v2 == null) return null;
    return {
      v1, v2, delta_pp: v2 - v1, pp_por_semana: +((v2 - v1) / semanas).toFixed(2),
    };
  }

  function deltaNacional(campo) {
    const v1 = primero.resultados.nacional?.[campo];
    const v2 = ultimo.resultados.nacional?.[campo];
    if (v1 == null || v2 == null) return null;
    return { v1, v2, delta_pp: v2 - v1, pp_por_semana: +((v2 - v1) / semanas).toFixed(2) };
  }

  return {
    n_polls: series.length,
    desde: primero.id,
    hasta: ultimo.id,
    dias_intervalo: +dias.toFixed(1),
    semanas_intervalo: +semanas.toFixed(2),
    nacional: {
      k: deltaNacional("k"),
      s: deltaNacional("s"),
      blanco_nulo: deltaNacional("blanco_nulo"),
      indeciso: deltaNacional("indeciso"),
    },
    lima_metro: {
      k: delta("lima_metro", "k"),
      s: delta("lima_metro", "s"),
      blanco_nulo: delta("lima_metro", "blanco_nulo"),
    },
    otras_ciudades: {
      k: delta("otras_ciudades", "k"),
      s: delta("otras_ciudades", "s"),
      blanco_nulo: delta("otras_ciudades", "blanco_nulo"),
    },
    rural: {
      k: delta("rural", "k"),
      s: delta("rural", "s"),
      blanco_nulo: delta("rural", "blanco_nulo"),
    },
  };
}

// ============================================================
// ESCENARIO MOMENTUM — extrapola velocidades al día D
// ============================================================
//
// Estructura:
//   1. Toma última encuesta IPSOS como punto de partida
//   2. Extrapola K/S por estrato con la velocidad observada (con dampening)
//   3. Reparte el limbo (indec + B/N) usando prior histórico
//   4. Combina estratos a nacional usando pesos electorales (Lima ~31%, Otras ~37%, Rural ~32%)
//
// Dampening: 50% de la velocidad observada. Las tendencias en 2V tienden a aplanarse
// cerca del día D (es una constante de la literatura electoral; campañas convergen).

const PESO_ELECTORAL = {
  lima_metro: 0.31,      // Lima Metro + Callao
  otras_ciudades: 0.37,  // Otras ciudades del interior (urbano-no-Lima)
  rural: 0.32,           // Rural
};

const DAMPENING = 0.50;  // 50% de la velocidad se mantiene hasta el día D

function escenarioMomentum(polls, velocidades, fechaObjetivo = DIA_ELECCION) {
  const ipsos = polls
    .filter(p => p.pollster === "IPSOS" && p.resultados.estratos?.lima_metro)
    .sort((a, b) => fechaEfectiva(a) - fechaEfectiva(b));
  if (ipsos.length < 2 || !velocidades) return null;

  const ultimo = ipsos[ipsos.length - 1];
  const diasAlDia = diasEntre(fechaEfectiva(ultimo), new Date(fechaObjetivo));
  const semanasAlDia = diasAlDia / 7;

  function extrapolar(estrato) {
    const r = ultimo.resultados.estratos[estrato];
    if (!r) return null;
    const vel = velocidades[estrato];
    const proyK = r.k + (vel.k?.pp_por_semana || 0) * semanasAlDia * DAMPENING;
    const proyS = r.s + (vel.s?.pp_por_semana || 0) * semanasAlDia * DAMPENING;
    const proyBN = r.blanco_nulo + (vel.blanco_nulo?.pp_por_semana || 0) * semanasAlDia * DAMPENING;
    const limboEstrato = Math.max(0, 100 - proyK - proyS - proyBN);
    return {
      pre_reparto: {
        k: +proyK.toFixed(2),
        s: +proyS.toFixed(2),
        blanco_nulo: +proyBN.toFixed(2),
        limbo_indeciso: +limboEstrato.toFixed(2),
      },
    };
  }

  // Paso 1: extrapolar pre-reparto
  const ext = {
    lima_metro: extrapolar("lima_metro"),
    otras_ciudades: extrapolar("otras_ciudades"),
    rural: extrapolar("rural"),
  };

  // Paso 2: reparto del limbo (indec + exceso BN sobre piso) por estrato
  // Líder = quien tiene más en el estrato
  function repartirLimbo(estr) {
    const p = estr.pre_reparto;
    const lider = p.k >= p.s ? "k" : "s";
    const rezagado = lider === "k" ? "s" : "k";
    // Exceso de B/N sobre piso (lo que probablemente se decida)
    const excesoBN = Math.max(0, p.blanco_nulo - PISO_BLANCO_NULO * 100);
    const masaADecidir = p.limbo_indeciso + excesoBN;
    // Sánchez (castillista) es percibido como más radical → bias al líder anti-castillista (K) si lidera
    const asymBonus = lider === "k" ? ASYM_SI_REZAGADO_RADICAL : 0;
    const shareLider = REPARTO_LIDER + asymBonus;
    const shareRezagado = REPARTO_REZAGADO - asymBonus;
    const aLider = masaADecidir * shareLider;
    const aRezagado = masaADecidir * shareRezagado;
    const aNuloExtra = masaADecidir * REPARTO_NULO_EXTRA;
    const finalK = p.k + (lider === "k" ? aLider : aRezagado);
    const finalS = p.s + (lider === "s" ? aLider : aRezagado);
    const finalBN = PISO_BLANCO_NULO * 100 + aNuloExtra;
    // Renormaliza para que K+S+BN = 100
    const tot = finalK + finalS + finalBN;
    const factor = 100 / tot;
    const fK = finalK * factor;
    const fS = finalS * factor;
    const fBN = finalBN * factor;
    // % sobre voto válido (sin BN)
    const valK = fK / (fK + fS) * 100;
    const valS = 100 - valK;
    return {
      pre_reparto: p,
      reparto: {
        lider, rezagado,
        masa_a_decidir_pp: +masaADecidir.toFixed(2),
        a_lider_pp: +aLider.toFixed(2),
        a_rezagado_pp: +aRezagado.toFixed(2),
        a_nulo_extra_pp: +aNuloExtra.toFixed(2),
      },
      final: {
        k_total: +fK.toFixed(2),
        s_total: +fS.toFixed(2),
        blanco_nulo: +fBN.toFixed(2),
      },
      final_valido: {
        k: +valK.toFixed(2),
        s: +valS.toFixed(2),
      },
    };
  }

  const repart = {
    lima_metro: repartirLimbo(ext.lima_metro),
    otras_ciudades: repartirLimbo(ext.otras_ciudades),
    rural: repartirLimbo(ext.rural),
  };

  // Paso 3: combinar a nacional con pesos electorales
  let nacK_valido = 0, nacS_valido = 0;
  for (const estrato of ["lima_metro", "otras_ciudades", "rural"]) {
    const w = PESO_ELECTORAL[estrato];
    nacK_valido += repart[estrato].final_valido.k * w;
    nacS_valido += repart[estrato].final_valido.s * w;
  }
  // Renormaliza
  const sumNac = nacK_valido + nacS_valido;
  const pctK = nacK_valido / sumNac * 100;
  const pctS = 100 - pctK;

  return {
    fecha_base: ultimo.id,
    fecha_objetivo: fechaObjetivo,
    dias_proyectados: Math.round(diasAlDia),
    dampening: DAMPENING,
    estratos: repart,
    pesos_electorales: PESO_ELECTORAL,
    prior_reparto_limbo: {
      piso_blanco_nulo: PISO_BLANCO_NULO,
      reparto_lider: REPARTO_LIDER,
      reparto_rezagado: REPARTO_REZAGADO,
      reparto_nulo_extra: REPARTO_NULO_EXTRA,
      asym_si_rezagado_radical: ASYM_SI_REZAGADO_RADICAL,
    },
    nacional_valido: {
      k: +pctK.toFixed(2),
      s: +pctS.toFixed(2),
      margen_pp: +(pctK - pctS).toFixed(2),
      ganador: pctK > pctS ? "K" : "S",
    },
  };
}

// ============================================================
// TRIPWIRES — 3 semáforos
// ============================================================
//
// 1. ANTIVOTO K — sigue bajando del 48%?
//    - verde (favorable a K): <45%
//    - amarillo (neutral): 45-50%
//    - rojo (favorable a S): >50%
//
// 2. SÁNCHEZ RURAL — recupera arriba de 50%?
//    - verde (favorable a S): >52%
//    - amarillo: 48-52%
//    - rojo (favorable a K): <48%
//
// 3. INDECISOS NACIONAL — subir = volatilidad
//    - verde (decidiendo, baja volatilidad): <10%
//    - amarillo: 10-15%
//    - rojo (volátil): >15%

function calcularTripwires(polls) {
  const sorted = polls.sort((a, b) => fechaEfectiva(a) - fechaEfectiva(b));
  const lastWithAnti = [...sorted].reverse().find(p => p.resultados.antivoto?.k != null);
  const lastWithRural = [...sorted].reverse().find(p => p.resultados.estratos?.rural?.s != null);
  const lastWithIndec = [...sorted].reverse().find(p => p.resultados.nacional?.indeciso != null);

  // Para tendencia: compara contra encuesta más antigua que tenga el dato
  const firstWithAnti = sorted.find(p => p.resultados.antivoto?.k != null);
  const firstWithRural = sorted.find(p => p.resultados.estratos?.rural?.s != null);
  const firstWithIndec = sorted.find(p => p.resultados.nacional?.indeciso != null);

  function diff(last, first, path) {
    if (!last || !first || last.id === first.id) return null;
    const v2 = path(last);
    const v1 = path(first);
    if (v1 == null || v2 == null) return null;
    return { from: v1, to: v2, delta_pp: +(v2 - v1).toFixed(1), from_id: first.id, to_id: last.id };
  }

  // Antivoto K
  const antiVal = lastWithAnti?.resultados.antivoto?.k;
  let antiEstado = "neutral";
  let antiSemaforo = "amarillo";
  if (antiVal != null) {
    if (antiVal < 45) { antiEstado = "favorable a Keiko"; antiSemaforo = "verde_k"; }
    else if (antiVal > 50) { antiEstado = "favorable a Sánchez"; antiSemaforo = "verde_s"; }
  }

  // Sánchez rural
  const rurVal = lastWithRural?.resultados.estratos?.rural?.s;
  let rurEstado = "empate técnico rural";
  let rurSemaforo = "amarillo";
  if (rurVal != null) {
    if (rurVal > 52) { rurEstado = "muralla rural Sánchez intacta"; rurSemaforo = "verde_s"; }
    else if (rurVal < 48) { rurEstado = "muralla rural rota → Keiko"; rurSemaforo = "verde_k"; }
  }

  // Indecisos
  const indVal = lastWithIndec?.resultados.nacional?.indeciso;
  let indEstado = "moderada volatilidad";
  let indSemaforo = "amarillo";
  if (indVal != null) {
    if (indVal < 10) { indEstado = "baja volatilidad — decidiéndose"; indSemaforo = "verde"; }
    else if (indVal > 15) { indEstado = "alta volatilidad — todo en limbo"; indSemaforo = "rojo"; }
  }

  return [
    {
      id: "antivoto_k",
      titulo: "Antivoto Keiko",
      pregunta: "¿Sigue bajando del 48%?",
      valor_actual: antiVal,
      unidad: "% que NO votaría por K",
      estado: antiEstado,
      semaforo: antiSemaforo,
      tendencia: diff(lastWithAnti, firstWithAnti, p => p.resultados.antivoto.k),
      umbrales: { verde_k: "<45%", amarillo: "45-50%", verde_s: ">50%" },
      ultima_medicion: lastWithAnti?.id || null,
      observacion: lastWithAnti?.fecha_campo?.[1] || null,
    },
    {
      id: "rural_sanchez",
      titulo: "Sánchez Rural",
      pregunta: "¿Recupera mayoría rural?",
      valor_actual: rurVal,
      unidad: "% rural por Sánchez",
      estado: rurEstado,
      semaforo: rurSemaforo,
      tendencia: diff(lastWithRural, firstWithRural, p => p.resultados.estratos.rural.s),
      umbrales: { verde_s: ">52%", amarillo: "48-52%", verde_k: "<48%" },
      ultima_medicion: lastWithRural?.id || null,
      observacion: lastWithRural?.fecha_campo?.[1] || null,
    },
    {
      id: "indecisos",
      titulo: "Indecisos Nacional",
      pregunta: "¿Sube (volatilidad) o baja (definición)?",
      valor_actual: indVal,
      unidad: "% NS/NR",
      estado: indEstado,
      semaforo: indSemaforo,
      tendencia: diff(lastWithIndec, firstWithIndec, p => p.resultados.nacional.indeciso),
      umbrales: { verde: "<10%", amarillo: "10-15%", rojo: ">15%" },
      ultima_medicion: lastWithIndec?.id || null,
      observacion: lastWithIndec?.fecha_campo?.[1] || null,
    },
  ];
}

// ============================================================
// ANCLAJE DOBLE — promedio ponderado por recencia y N
// ============================================================
//
// Cada encuesta tiene un peso = N_muestra * exp(-dias_desde_publicacion / tau)
// tau = 14 días → encuesta de hace 2 semanas pesa ~37% lo que pesa una de hoy.

function anclajeDoble(polls, refDate = new Date(), tauDias = 14) {
  const TAU = tauDias;
  const items = polls
    .filter(p => p.tipo !== "simulacro" && p.resultados.nacional?.k != null && p.resultados.nacional?.s != null)
    .map(p => {
      const dias = diasEntre(fechaEfectiva(p), refDate);
      const peso = p.n * Math.exp(-dias / TAU);
      return { id: p.id, pollster: p.pollster, n: p.n, dias, peso, k: p.resultados.nacional.k, s: p.resultados.nacional.s };
    });
  const wTot = items.reduce((s, x) => s + x.peso, 0);
  const wK = items.reduce((s, x) => s + x.k * x.peso, 0) / wTot;
  const wS = items.reduce((s, x) => s + x.s * x.peso, 0) / wTot;
  // Sobre válido (renormalizado a 100)
  const valK = wK / (wK + wS) * 100;
  return {
    tau_dias: TAU,
    fecha_referencia: refDate.toISOString().slice(0, 10),
    items: items.map(x => ({ ...x, peso_norm: +(x.peso / wTot).toFixed(3) })),
    promedio_ponderado: {
      k_total: +wK.toFixed(2),
      s_total: +wS.toFixed(2),
      val_k: +valK.toFixed(2),
      val_s: +(100 - valK).toFixed(2),
    },
  };
}

// ============================================================
// ANCLAJE SIMULACROS — promedio ponderado por N de los simulacros de cédula
// ============================================================
//
// Los simulacros de cédula (Datum/Ipsos) miden el resultado DIRECTAMENTE sobre voto
// válido (k+s=100), excluyendo el limbo de indecisos/blanco-nulo (22-25% en 2026).
// Son la única estimación directa del balotaje, complementaria al anclaje doble que
// se calcula sobre intención (total) y luego renormaliza. Se promedian aparte y se
// blendean en build_segunda_vuelta.js (60% anclaje doble / 40% simulacros).

function anclajeSimulacros(polls) {
  const sims = polls.filter(p => p.tipo === "simulacro" && p.resultados.nacional?.k != null);
  if (sims.length === 0) return null;
  const wTot = sims.reduce((s, p) => s + p.n, 0);
  const valK = sims.reduce((s, p) => s + p.resultados.nacional.k * p.n, 0) / wTot;
  return {
    n_simulacros: sims.length,
    items: sims.map(p => ({
      id: p.id, pollster: p.pollster, n: p.n,
      val_k: p.resultados.nacional.k, val_s: p.resultados.nacional.s,
      fecha_campo: p.fecha_campo,
    })),
    promedio_ponderado: {
      val_k: +valK.toFixed(2),
      val_s: +(100 - valK).toFixed(2),
    },
  };
}

// ============================================================
// MAIN — analiza polls.json y devuelve objeto completo
// ============================================================

function analizarPolls(pollsPath = "./polls.json") {
  const data = JSON.parse(fs.readFileSync(pollsPath, "utf8"));
  const polls = data.polls || [];

  const velocidades = calcularVelocidades(polls);
  const momentum = escenarioMomentum(polls, velocidades);
  const tripwires = calcularTripwires(polls);
  const ancla = anclajeDoble(polls);
  const anclaSim = anclajeSimulacros(polls);

  return {
    meta: {
      generated_at: new Date().toISOString(),
      n_polls: polls.length,
      n_simulacros: anclaSim?.n_simulacros || 0,
      dia_eleccion: DIA_ELECCION,
    },
    polls_resumen: polls.map(p => ({
      id: p.id,
      pollster: p.pollster,
      tipo: p.tipo || "nacional",
      fecha_publicacion: p.fecha_publicacion,
      fecha_campo: p.fecha_campo,
      n: p.n,
      nacional: p.resultados.nacional,
      tiene_estratos: !!p.resultados.estratos,
      tiene_antivoto: !!p.resultados.antivoto,
    })),
    velocidades,
    escenario_momentum: momentum,
    tripwires,
    anclaje_doble: ancla,
    anclaje_simulacros: anclaSim,
  };
}

module.exports = { analizarPolls, calcularVelocidades, escenarioMomentum, calcularTripwires, anclajeDoble, anclajeSimulacros };

// CLI: node polls_engine.js → imprime análisis
if (require.main === module) {
  const out = analizarPolls();
  console.log(JSON.stringify(out, null, 2));
}
