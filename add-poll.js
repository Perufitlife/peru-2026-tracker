#!/usr/bin/env node
/**
 * add-poll.js — appendea una encuesta nueva a polls.json y regenera el modelo.
 *
 * USO:
 *   node add-poll.js <archivo.json>          # archivo con objeto poll
 *   node add-poll.js                          # lee de stdin
 *   node add-poll.js --interactive            # prompts línea por línea
 *
 * SCHEMA MÍNIMO de la encuesta (objeto JSON):
 * {
 *   "pollster": "IPSOS",
 *   "client": "Perú21",
 *   "fecha_campo": ["2026-MM-DD", "2026-MM-DD"],
 *   "fecha_publicacion": "2026-MM-DD",
 *   "n": 1200,
 *   "error_pp": 2.8,
 *   "resultados": {
 *     "nacional": { "k": 39, "s": 35, "blanco_nulo": 14, "indeciso": 12 },
 *     "estratos": { "lima_metro": {...}, "otras_ciudades": {...}, "rural": {...} },
 *     "antivoto": { "k": 48, "s": 43 }
 *   },
 *   "url": "..."
 * }
 *
 * El `id` se genera automáticamente como `${pollster.lower}-${fecha_campo[1]}`.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const POLLS_FILE = path.join(__dirname, "polls.json");

function loadPolls() {
  if (!fs.existsSync(POLLS_FILE)) throw new Error(`No existe ${POLLS_FILE}`);
  return JSON.parse(fs.readFileSync(POLLS_FILE, "utf8"));
}

function validate(p) {
  const errors = [];
  if (!p.pollster) errors.push("Falta `pollster`");
  if (!Array.isArray(p.fecha_campo) || p.fecha_campo.length !== 2) errors.push("`fecha_campo` debe ser [start, end] ISO yyyy-mm-dd");
  if (p.fecha_campo && (isNaN(new Date(p.fecha_campo[0])) || isNaN(new Date(p.fecha_campo[1])))) errors.push("fechas de campo no válidas");
  if (!p.n || typeof p.n !== "number") errors.push("Falta `n` (tamaño muestra)");
  const r = p.resultados;
  if (!r || !r.nacional) errors.push("Falta `resultados.nacional`");
  if (r?.nacional) {
    if (r.nacional.k == null || r.nacional.s == null) errors.push("Falta resultados.nacional.k o .s");
    const sum = (r.nacional.k || 0) + (r.nacional.s || 0) + (r.nacional.blanco_nulo || 0) + (r.nacional.indeciso || 0);
    if (Math.abs(sum - 100) > 2) errors.push(`Suma nacional = ${sum}, esperado ~100`);
  }
  return errors;
}

function readInput(args) {
  if (args[0] && args[0] !== "--stdin") {
    const filepath = args[0];
    if (!fs.existsSync(filepath)) throw new Error(`No existe archivo: ${filepath}`);
    return JSON.parse(fs.readFileSync(filepath, "utf8"));
  }
  // stdin
  const data = fs.readFileSync(0, "utf8");
  return JSON.parse(data);
}

function generateId(poll) {
  const slug = poll.pollster.toLowerCase().replace(/[^a-z0-9]/g, "");
  const date = poll.fecha_campo[1];
  return `${slug}-${date}`;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(2, 27).join("\n"));
    return;
  }

  let newPoll;
  try {
    newPoll = readInput(args);
  } catch (e) {
    console.error("❌ Error leyendo input:", e.message);
    console.error("   Uso: node add-poll.js <archivo.json>  o  cat poll.json | node add-poll.js");
    process.exit(1);
  }

  // Validar
  const errors = validate(newPoll);
  if (errors.length > 0) {
    console.error("❌ Encuesta inválida:");
    errors.forEach(e => console.error(`   - ${e}`));
    process.exit(1);
  }

  // Generar id si no viene
  if (!newPoll.id) newPoll.id = generateId(newPoll);
  if (!newPoll.tipo) newPoll.tipo = "nacional";
  if (!newPoll.fecha_publicacion) newPoll.fecha_publicacion = new Date().toISOString().slice(0, 10);

  // Cargar timeseries y verificar duplicados
  const polls = loadPolls();
  const dup = polls.polls.find(p => p.id === newPoll.id);
  if (dup) {
    console.log(`⚠️  Ya existe encuesta con id "${newPoll.id}". ¿Sobrescribir? (no implementado; cambia el id si quieres añadir otra del mismo día)`);
    process.exit(2);
  }

  polls.polls.push(newPoll);
  polls.polls.sort((a, b) => a.fecha_campo[1].localeCompare(b.fecha_campo[1]));

  fs.writeFileSync(POLLS_FILE, JSON.stringify(polls, null, 2) + "\n");
  console.log(`✅ Agregada: ${newPoll.id} (${newPoll.pollster} · n=${newPoll.n} · K ${newPoll.resultados.nacional.k}% / S ${newPoll.resultados.nacional.s}%)`);
  console.log(`   Total encuestas en timeseries: ${polls.polls.length}`);

  // Regenerar modelo
  console.log("\n🔄 Regenerando segunda_vuelta_2026.json...");
  try {
    execSync("node build_segunda_vuelta.js", { stdio: "inherit", cwd: __dirname });
  } catch (e) {
    console.error("⚠️  Build falló — encuesta agregada pero modelo no se regeneró. Corre `node build_segunda_vuelta.js` manualmente.");
    process.exit(3);
  }
  console.log("\n✅ Done. Push para deployar:  git add polls.json segunda_vuelta_2026.json && git commit -m 'add poll' && git push");
}

main();
