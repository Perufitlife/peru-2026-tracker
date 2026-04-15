const { chromium } = require('playwright');
const fs = require('fs');

const BATCH_SIZE = 6;
const BASE = 'https://resultadoelectoral.onpe.gob.pe/presentacion-backend';

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

  // Step 1: Navigate and wait for Angular to boot
  console.log('Loading ONPE page...');
  await page.goto('https://resultadoelectoral.onpe.gob.pe/main/resumen', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  // Wait for Angular to make its first API call — this proves the app booted
  console.log('Waiting for Angular to boot...');
  try {
    await page.waitForResponse(
      res => res.url().includes('presentacion-backend') && res.status() === 200,
      { timeout: 20000 }
    );
    console.log('Angular booted OK');
  } catch {
    // If Angular didn't boot, try navigating directly to a simple page first
    console.log('Angular did not boot, trying alternative...');
    await page.goto('https://resultadoelectoral.onpe.gob.pe/', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    // Then navigate to resumen
    await page.goto('https://resultadoelectoral.onpe.gob.pe/main/resumen', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
  }

  // Step 2: Health check via browser context
  console.log('Health check...');
  const health = await page.evaluate(async (base) => {
    try {
      const r = await fetch(`${base}/proceso/proceso-electoral-activo`);
      return await r.json();
    } catch(e) {
      return { error: e.message };
    }
  }, BASE);

  if (!health?.success) {
    console.error('FAIL: Cannot reach ONPE API from browser context.');
    console.error('Response:', JSON.stringify(health));
    // Last resort: try a page reload and wait longer
    console.log('Retrying with full page reload...');
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));

    const health2 = await page.evaluate(async (base) => {
      try {
        const r = await fetch(`${base}/proceso/proceso-electoral-activo`);
        return await r.json();
      } catch(e) {
        return { error: e.message };
      }
    }, BASE);

    if (!health2?.success) {
      console.error('FAIL after retry:', JSON.stringify(health2));
      await browser.close();
      process.exit(1);
    }
    console.log('Retry succeeded!');
  }
  console.log(`OK: ${health.data?.nombre || 'connected'}\n`);

  // API helper — runs fetch inside browser context
  async function api(url) {
    try {
      const text = await page.evaluate(async (u) => {
        const r = await fetch(u);
        return await r.text();
      }, url);
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  // 1. National data in parallel
  console.log('Fetching national data...');
  const [totals, cands, depts, extTotals, extCands] = await Promise.all([
    api(`${BASE}/resumen-general/totales?idEleccion=10&tipoFiltro=eleccion`),
    api(`${BASE}/resumen-general/participantes?idEleccion=10&tipoFiltro=eleccion`),
    api(`${BASE}/ubigeos/departamentos?idEleccion=10&idAmbitoGeografico=1`),
    api(`${BASE}/resumen-general/totales?idAmbitoGeografico=2&idEleccion=10&tipoFiltro=ambito_geografico`),
    api(`${BASE}/resumen-general/participantes?idAmbitoGeografico=2&idEleccion=10&tipoFiltro=ambito_geografico`),
  ]);

  if (!depts?.data || !totals?.data || !cands?.data) {
    console.error('FAIL: Base data missing.');
    console.error('  totals:', !!totals?.data, 'cands:', !!cands?.data, 'depts:', !!depts?.data);
    await browser.close();
    process.exit(1);
  }
  console.log(`National OK — ${depts.data.length} departments\n`);

  // 2. Departments in parallel
  console.log('Fetching departments...');
  const deptResults = await batch(depts.data, async (dept) => {
    const ub = dept.ubigeo;
    const [dt, dc, provList] = await Promise.all([
      api(`${BASE}/resumen-general/totales?idAmbitoGeografico=1&idEleccion=10&tipoFiltro=ubigeo_nivel_01&idUbigeoDepartamento=${ub}`),
      api(`${BASE}/resumen-general/participantes?idAmbitoGeografico=1&idEleccion=10&tipoFiltro=ubigeo_nivel_01&idUbigeoDepartamento=${ub}`),
      api(`${BASE}/ubigeos/provincias?idEleccion=10&idAmbitoGeografico=1&idUbigeoDepartamento=${ub}`),
    ]);
    if (!dt?.data || !dc?.data) {
      console.log(`  ${dept.nombre} SKIP`);
      return null;
    }

    // Province-level precision
    let votosFaltanPreciso = 0;
    if (provList?.data?.length) {
      const provResults = await batch(provList.data, async (prov) =>
        api(`${BASE}/resumen-general/totales?idAmbitoGeografico=1&idEleccion=10&tipoFiltro=ubigeo_nivel_02&idUbigeoDepartamento=${ub}&idUbigeoProvincia=${prov.ubigeo}`)
      );
      const deptVpa = dt.data.contabilizadas > 0 ? dt.data.totalVotosEmitidos / dt.data.contabilizadas : 0;
      for (const pt of provResults) {
        if (!pt?.data) continue;
        const ac = pt.data.contabilizadas, at = pt.data.totalActas, af = at - ac;
        if (ac > 0 && af > 0) votosFaltanPreciso += Math.round((pt.data.totalVotosEmitidos / ac) * af);
        else if (ac === 0 && at > 0) votosFaltanPreciso += Math.round(deptVpa * at);
      }
    }

    console.log(`  ${dept.nombre} OK`);
    return {
      nombre: dept.nombre, ubigeo: ub,
      totales: dt.data,
      candidatos: dc.data.sort((a, b) => b.totalVotosValidos - a.totalVotosValidos),
      votosFaltanPreciso
    };
  });

  const departamentos = deptResults.filter(Boolean);

  // Safety: don't save partial data
  if (departamentos.length < 20) {
    console.error(`FAIL: Only ${departamentos.length} departments fetched (expected 25+). Not saving.`);
    await browser.close();
    process.exit(1);
  }

  // Add extranjero
  if (extTotals?.data) {
    const ac = extTotals.data.contabilizadas, af = extTotals.data.totalActas - ac;
    departamentos.push({
      nombre: 'EXTRANJERO', ubigeo: '999999',
      totales: extTotals.data,
      candidatos: (extCands?.data || []).sort((a, b) => b.totalVotosValidos - a.totalVotosValidos),
      votosFaltanPreciso: ac > 0 ? Math.round((extTotals.data.totalVotosEmitidos / ac) * af) : 0
    });
  }

  const data = {
    timestamp: new Date().toISOString(),
    nacional: { totales: totals.data, candidatos: cands.data.sort((a, b) => b.totalVotosValidos - a.totalVotosValidos) },
    departamentos
  };

  fs.writeFileSync(__dirname + '/data.json', JSON.stringify(data, null, 2));
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${departamentos.length} departments — ${data.timestamp}`);
  await browser.close();
})();
