/**
 * build_baseline_2021.js — Baseline 2021 2da vuelta (Castillo vs Fujimori) por DISTRITO.
 *
 * Genera baseline_2021_2v.json. Dos modos:
 *   A) OFICIAL: si existe `oficial_2021_2v_mesas.csv` (descarga ONPE datosabiertos,
 *      cómputo 100%), agrega por ubigeo → conteos exactos.
 *   B) CALIBRADO (default): rakea el snapshot 98.5% (forensic_2021_provincias.json)
 *      a los totales oficiales nacionales. % por distrito casi-finales, nacional exacto.
 *
 * Para swappear a oficial: dejar el CSV en la carpeta y re-correr. Detecta solo.
 */
const fs = require("fs");

// Cómputo oficial ONPE 100% (2V 2021). 2 candidatos → validos = K + C.
const OFICIAL = { K: 8792117, C: 8836380, validos: 17628497, pct_K: 49.875, pct_C: 50.125, margen: -44263 };

const CSV_OFICIAL = "oficial_2021_2v_mesas.csv";

function fromCalibration() {
  const f = require("./forensic_2021_provincias.json");
  const ds = f.distritos;
  const sumK = ds.reduce((a, d) => a + d.votos_K, 0);
  const sumC = ds.reduce((a, d) => a + d.votos_C, 0);
  const fK = OFICIAL.K / sumK;
  const fC = OFICIAL.C / sumC;
  const distritos = ds.map(d => {
    const vK = Math.round(d.votos_K * fK);
    const vC = Math.round(d.votos_C * fC);
    const val = vK + vC;
    return {
      ubigeo: String(d.ubigeo), departamento: d.departamento, provincia: d.provincia, distrito: d.distrito,
      votos_K: vK, votos_C: vC, validos: val,
      pct_K: +(vK / val * 100).toFixed(2), pct_C: +(vC / val * 100).toFixed(2),
      margen: vK - vC, ganador: vK >= vC ? "K" : "C", mesas: d.mesas,
    };
  });
  return {
    calibrado: true,
    fuente: "snapshot 98.5% (forensic_2021_provincias) rakeado proporcionalmente al cómputo oficial ONPE 100%",
    factores: { K: +fK.toFixed(6), C: +fC.toFixed(6) },
    distritos,
  };
}

function fromOfficialCSV() {
  // Esquema esperado (datosabiertos ONPE, por mesa): columnas con ubigeo del local,
  // candidato y votos. Se agrega por ubigeo de distrito (6 dígitos). Ajustar índices
  // según el data dictionary real cuando se tenga el archivo.
  const raw = fs.readFileSync(CSV_OFICIAL, "utf8").trim().split(/\r?\n/);
  const header = raw[0].split(/[,;]/).map(s => s.trim().toUpperCase());
  const idx = name => header.findIndex(h => h.includes(name));
  const iUbi = [idx("UBIGEO"), idx("CCODI_UBIGEO"), idx("UBIDIST")].find(i => i >= 0);
  const iCand = [idx("CANDIDATO"), idx("AGRUPAC"), idx("ORGANIZAC")].find(i => i >= 0);
  const iVot = [idx("VOTOS"), idx("N_VOTOS"), idx("TOTAL")].find(i => i >= 0);
  if (iUbi == null || iCand == null || iVot == null) {
    throw new Error(`No pude mapear columnas del CSV oficial. Header: ${header.join("|")}`);
  }
  const map = new Map();
  for (let i = 1; i < raw.length; i++) {
    const c = raw[i].split(/[,;]/);
    const ubi6 = String(c[iUbi]).trim().slice(0, 6).padStart(6, "0");
    const cand = (c[iCand] || "").toUpperCase();
    const votos = parseInt(c[iVot], 10) || 0;
    if (!map.has(ubi6)) map.set(ubi6, { votos_K: 0, votos_C: 0 });
    const e = map.get(ubi6);
    if (/CASTILLO|PERU LIBRE/.test(cand)) e.votos_C += votos;
    else if (/FUJIMORI|FUERZA POPULAR/.test(cand)) e.votos_K += votos;
  }
  // Necesita nombres de distrito → los tomo del forense para no perder labels
  const f = require("./forensic_2021_provincias.json");
  const labels = new Map(f.distritos.map(d => [String(d.ubigeo), d]));
  const distritos = [...map.entries()].map(([ubigeo, e]) => {
    const L = labels.get(ubigeo) || {};
    const val = e.votos_K + e.votos_C;
    return {
      ubigeo, departamento: L.departamento || "?", provincia: L.provincia || "?", distrito: L.distrito || ubigeo,
      votos_K: e.votos_K, votos_C: e.votos_C, validos: val,
      pct_K: val ? +(e.votos_K / val * 100).toFixed(2) : 0, pct_C: val ? +(e.votos_C / val * 100).toFixed(2) : 0,
      margen: e.votos_K - e.votos_C, ganador: e.votos_K >= e.votos_C ? "K" : "C", mesas: L.mesas || null,
    };
  });
  return { calibrado: false, fuente: `CSV oficial ONPE (${CSV_OFICIAL}) agregado por ubigeo`, factores: null, distritos };
}

const base = fs.existsSync(CSV_OFICIAL) ? fromOfficialCSV() : fromCalibration();

const out = {
  meta: {
    generated_at: new Date().toISOString(),
    eleccion: "Segunda vuelta 2021 — Pedro Castillo (Perú Libre) vs Keiko Fujimori (Fuerza Popular) · 6-jun-2021",
    nacional_oficial: OFICIAL,
    calibrado: base.calibrado,
    fuente: base.fuente,
    factores_rake: base.factores,
    n_distritos: base.distritos.length,
    nota: base.calibrado
      ? "Conteos por distrito CALIBRADOS al cómputo oficial 100% (rake proporcional sobre snapshot 98.5%). % casi-finales. Para conteos crudos oficiales, dejar oficial_2021_2v_mesas.csv en la carpeta y re-correr."
      : "Conteos OFICIALES por distrito (cómputo ONPE 100%).",
  },
  distritos: base.distritos,
};

fs.writeFileSync("baseline_2021_2v.json", JSON.stringify(out));
const sK = base.distritos.reduce((a, d) => a + d.votos_K, 0);
const sC = base.distritos.reduce((a, d) => a + d.votos_C, 0);
console.log(`baseline_2021_2v.json escrito · ${base.distritos.length} distritos · calibrado=${base.calibrado}`);
console.log(`Suma: K ${sK.toLocaleString()} · C ${sC.toLocaleString()} · margen ${(sK - sC).toLocaleString()} (oficial K 8,792,117 / C 8,836,380 / margen -44,263)`);
