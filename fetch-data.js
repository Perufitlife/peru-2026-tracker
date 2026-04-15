const { chromium } = require('playwright');
const fs = require('fs');

const BATCH_SIZE = 8;
const BASE = 'https://resultadoelectoral.onpe.gob.pe/presentacion-backend';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

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

  // Step 1: Use browser to visit page and capture cookies + working session
  console.log('Opening browser to get session...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA });
  const page = await context.newPage();

  // Capture API responses as they happen during page load
  const capturedCookies = [];
  const capturedHeaders = {};

  page.on('request', req => {
    if (req.url().includes('presentacion-backend') && req.resourceType() === 'fetch') {
      const h = req.headers();
      Object.assign(capturedHeaders, h);
    }
  });

  await page.goto('https://resultadoelectoral.onpe.gob.pe/main/resumen', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  // Wait for Angular to make at least one API call
  try {
    await page.waitForResponse(
      res => res.url().includes('presentacion-backend') && res.status() === 200,
      { timeout: 15000 }
    );
    console.log('Angular API call detected — session is valid');
  } catch {
    console.log('Warning: no API call detected, proceeding anyway');
  }

  // Get cookies from browser
  const cookies = await context.cookies();
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  console.log(`Cookies captured: ${cookies.length}`);

  await browser.close();
  console.log('Browser closed, switching to direct fetch\n');

  // Step 2: Direct fetch using Node.js native fetch with captured cookies
  async function api(url) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept': 'application/json',
          'Referer': 'https://resultadoelectoral.onpe.gob.pe/main/resumen',
          'Cookie': cookieStr,
        }
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  // Health check — verify API is reachable
  console.log('Health check...');
  const health = await api(`${BASE}/proceso/proceso-electoral-activo`);
  if (!health?.success) {
    console.error('FAIL: Cannot reach ONPE API. Response:', JSON.stringify(health));
    process.exit(1);
  }
  console.log(`OK: ${health.data.nombre}\n`);

  // 1. Parallel: national totals + candidates + departments list + extranjero
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
    process.exit(1);
  }
  console.log(`National OK — ${depts.data.length} departments\n`);

  // 2. Parallel: all department totals + candidates + province lists
  console.log('Fetching departments...');
  const deptResults = await batch(depts.data, async (dept) => {
    const ub = dept.ubigeo;
    const [dt, dc, provList] = await Promise.all([
      api(`${BASE}/resumen-general/totales?idAmbitoGeografico=1&idEleccion=10&tipoFiltro=ubigeo_nivel_01&idUbigeoDepartamento=${ub}`),
      api(`${BASE}/resumen-general/participantes?idAmbitoGeografico=1&idEleccion=10&tipoFiltro=ubigeo_nivel_01&idUbigeoDepartamento=${ub}`),
      api(`${BASE}/ubigeos/provincias?idEleccion=10&idAmbitoGeografico=1&idUbigeoDepartamento=${ub}`),
    ]);
    if (!dt?.data || !dc?.data) {
      console.log(`  ${dept.nombre} SKIP (no data)`);
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
})();
