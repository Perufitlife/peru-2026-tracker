const { chromium } = require('playwright');
const fs = require('fs');

const BATCH_SIZE = 8; // concurrent requests

async function batch(items, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    results.push(...await Promise.all(chunk.map(fn)));
  }
  return results;
}

(async () => {
  const t0 = Date.now();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  await page.goto('https://resultadoelectoral.onpe.gob.pe/main/resumen', { waitUntil: 'networkidle', timeout: 30000 });

  const BASE = 'https://resultadoelectoral.onpe.gob.pe/presentacion-backend';

  async function api(url) {
    const text = await page.evaluate(async (u) => {
      const r = await fetch(u);
      return await r.text();
    }, url);
    try { return JSON.parse(text); } catch { return null; }
  }

  // 1. Parallel: national totals + candidates + departments list
  console.log('Fetching national + departments...');
  const [totals, cands, depts, extTotals, extCands] = await Promise.all([
    api(`${BASE}/resumen-general/totales?idEleccion=10&tipoFiltro=eleccion`),
    api(`${BASE}/resumen-general/participantes?idEleccion=10&tipoFiltro=eleccion`),
    api(`${BASE}/ubigeos/departamentos?idEleccion=10&idAmbitoGeografico=1`),
    api(`${BASE}/resumen-general/totales?idAmbitoGeografico=2&idEleccion=10&tipoFiltro=ambito_geografico`),
    api(`${BASE}/resumen-general/participantes?idAmbitoGeografico=2&idEleccion=10&tipoFiltro=ambito_geografico`),
  ]);

  // 2. Parallel: all department totals + candidates
  console.log('Fetching all departments in parallel...');
  const deptResults = await batch(depts.data, async (dept) => {
    const ub = dept.ubigeo;
    const [dt, dc, provList] = await Promise.all([
      api(`${BASE}/resumen-general/totales?idAmbitoGeografico=1&idEleccion=10&tipoFiltro=ubigeo_nivel_01&idUbigeoDepartamento=${ub}`),
      api(`${BASE}/resumen-general/participantes?idAmbitoGeografico=1&idEleccion=10&tipoFiltro=ubigeo_nivel_01&idUbigeoDepartamento=${ub}`),
      api(`${BASE}/ubigeos/provincias?idEleccion=10&idAmbitoGeografico=1&idUbigeoDepartamento=${ub}`),
    ]);
    if (!dt?.data || !dc?.data) return null;

    // 3. Parallel: all province totals for precise estimate
    let votosFaltanPreciso = 0;
    if (provList?.data?.length) {
      const provResults = await batch(provList.data, async (prov) => {
        return api(`${BASE}/resumen-general/totales?idAmbitoGeografico=1&idEleccion=10&tipoFiltro=ubigeo_nivel_02&idUbigeoDepartamento=${ub}&idUbigeoProvincia=${prov.ubigeo}`);
      });
      const deptVpa = dt.data.contabilizadas > 0 ? dt.data.totalVotosEmitidos / dt.data.contabilizadas : 0;
      for (const pt of provResults) {
        if (!pt?.data) continue;
        const ac = pt.data.contabilizadas;
        const at = pt.data.totalActas;
        const af = at - ac;
        if (ac > 0 && af > 0) {
          votosFaltanPreciso += Math.round((pt.data.totalVotosEmitidos / ac) * af);
        } else if (ac === 0 && at > 0) {
          votosFaltanPreciso += Math.round(deptVpa * at);
        }
      }
    }

    process.stdout.write(`  ${dept.nombre} OK\n`);
    return {
      nombre: dept.nombre,
      ubigeo: ub,
      totales: dt.data,
      candidatos: dc.data.sort((a, b) => b.totalVotosValidos - a.totalVotosValidos),
      votosFaltanPreciso
    };
  });

  const departamentos = deptResults.filter(Boolean);

  // Add extranjero
  if (extTotals?.data) {
    const ac = extTotals.data.contabilizadas;
    const af = extTotals.data.totalActas - ac;
    departamentos.push({
      nombre: 'EXTRANJERO',
      ubigeo: '999999',
      totales: extTotals.data,
      candidatos: (extCands?.data || []).sort((a, b) => b.totalVotosValidos - a.totalVotosValidos),
      votosFaltanPreciso: ac > 0 ? Math.round((extTotals.data.totalVotosEmitidos / ac) * af) : 0
    });
  }

  const data = {
    timestamp: new Date().toISOString(),
    nacional: {
      totales: totals.data,
      candidatos: cands.data.sort((a, b) => b.totalVotosValidos - a.totalVotosValidos)
    },
    departamentos
  };

  fs.writeFileSync(__dirname + '/data.json', JSON.stringify(data, null, 2));
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${data.timestamp}`);
  await browser.close();
})();
