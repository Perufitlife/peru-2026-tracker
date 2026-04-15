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

    // Province-level: totals + candidates
    let votosFaltanPreciso = 0;
    const provincias = [];
    if (provList?.data?.length) {
      const provResults = await batch(provList.data, async (prov) => {
        const [pt, pc, distList] = await Promise.all([
          api(`${BASE}/resumen-general/totales?idAmbitoGeografico=1&idEleccion=10&tipoFiltro=ubigeo_nivel_02&idUbigeoDepartamento=${ub}&idUbigeoProvincia=${prov.ubigeo}`),
          api(`${BASE}/resumen-general/participantes?idAmbitoGeografico=1&idEleccion=10&tipoFiltro=ubigeo_nivel_02&idUbigeoDepartamento=${ub}&idUbigeoProvincia=${prov.ubigeo}`),
          api(`${BASE}/ubigeos/distritos?idEleccion=10&idAmbitoGeografico=1&idUbigeoProvincia=${prov.ubigeo}`),
        ]);
        // Fetch districts
        let distritos = [];
        if (distList?.data?.length) {
          const distResults = await batch(distList.data, async (dist) => {
            const [dtt, dtc] = await Promise.all([
              api(`${BASE}/resumen-general/totales?idAmbitoGeografico=1&idEleccion=10&tipoFiltro=ubigeo_nivel_03&idUbigeoDepartamento=${ub}&idUbigeoProvincia=${prov.ubigeo}&idUbigeoDistrito=${dist.ubigeo}`),
              api(`${BASE}/resumen-general/participantes?idAmbitoGeografico=1&idEleccion=10&tipoFiltro=ubigeo_nivel_03&idUbigeoDepartamento=${ub}&idUbigeoProvincia=${prov.ubigeo}&idUbigeoDistrito=${dist.ubigeo}`),
            ]);
            return { nombre: dist.nombre, ubigeo: dist.ubigeo, totales: dtt?.data, candidatos: dtc?.data };
          });
          for (const d of distResults) {
            if (!d.totales) continue;
            const dac = d.totales.contabilizadas, dat = d.totales.totalActas, daf = dat - dac;
            const dVpa = dac > 0 ? d.totales.totalVotosEmitidos / dac : 0;
            distritos.push({
              nombre: d.nombre, ubigeo: d.ubigeo,
              totales: d.totales,
              candidatos: (d.candidatos || []).sort((a, b) => b.totalVotosValidos - a.totalVotosValidos),
              votosFaltanPreciso: Math.round(dVpa * daf)
            });
          }
        }
        return { nombre: prov.nombre, ubigeo: prov.ubigeo, totales: pt?.data, candidatos: pc?.data, distritos };
      });
      const deptVpa = dt.data.contabilizadas > 0 ? dt.data.totalVotosEmitidos / dt.data.contabilizadas : 0;
      for (const prov of provResults) {
        if (!prov.totales) continue;
        const provVpa = prov.totales.contabilizadas > 0 ? prov.totales.totalVotosEmitidos / prov.totales.contabilizadas : deptVpa;
        // Calculate province votosFaltan from district-level sums (most precise)
        let provVotosFaltan;
        if (prov.distritos?.length > 0) {
          provVotosFaltan = prov.distritos.reduce((sum, d) => sum + (d.votosFaltanPreciso || 0), 0);
        } else {
          const af = prov.totales.totalActas - prov.totales.contabilizadas;
          provVotosFaltan = Math.round(provVpa * af);
        }
        votosFaltanPreciso += provVotosFaltan;
        provincias.push({
          nombre: prov.nombre, ubigeo: prov.ubigeo,
          totales: prov.totales,
          candidatos: (prov.candidatos || []).sort((a, b) => b.totalVotosValidos - a.totalVotosValidos),
          distritos: prov.distritos,
          votosFaltanPreciso: provVotosFaltan
        });
      }
    }

    console.log(`  ${dept.nombre} OK (${provincias.length} provs)`);
    return {
      nombre: dept.nombre, ubigeo: ub,
      totales: dt.data,
      candidatos: dc.data.sort((a, b) => b.totalVotosValidos - a.totalVotosValidos),
      provincias,
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

  // Add extranjero with country breakdown
  console.log('\nFetching extranjero...');
  if (extTotals?.data) {
    const ac = extTotals.data.contabilizadas, af = extTotals.data.totalActas - ac;
    const extVpa = ac > 0 ? extTotals.data.totalVotosEmitidos / ac : 0;

    // Fetch continents → countries
    const continents = await api(`${BASE}/ubigeos/departamentos?idEleccion=10&idAmbitoGeografico=2`);
    const paises = [];
    if (continents?.data) {
      for (const cont of continents.data) {
        const countries = await api(`${BASE}/ubigeos/provincias?idEleccion=10&idAmbitoGeografico=2&idUbigeoDepartamento=${cont.ubigeo}`);
        if (!countries?.data) continue;
        const countryResults = await batch(countries.data, async (country) => {
          const [ct, cc] = await Promise.all([
            api(`${BASE}/resumen-general/totales?idAmbitoGeografico=2&idEleccion=10&tipoFiltro=ubigeo_nivel_02&idUbigeoDepartamento=${cont.ubigeo}&idUbigeoProvincia=${country.ubigeo}`),
            api(`${BASE}/resumen-general/participantes?idAmbitoGeografico=2&idEleccion=10&tipoFiltro=ubigeo_nivel_02&idUbigeoDepartamento=${cont.ubigeo}&idUbigeoProvincia=${country.ubigeo}`),
          ]);
          return { nombre: country.nombre, ubigeo: country.ubigeo, continente: cont.nombre, totales: ct?.data, candidatos: cc?.data };
        });
        for (const p of countryResults) {
          if (!p.totales) continue;
          const pac = p.totales.contabilizadas, pat = p.totales.totalActas, paf = pat - pac;
          const pVpa = pac > 0 ? p.totales.totalVotosEmitidos / pac : extVpa;
          paises.push({
            nombre: p.nombre, ubigeo: p.ubigeo, continente: p.continente,
            totales: p.totales,
            candidatos: (p.candidatos || []).sort((a, b) => b.totalVotosValidos - a.totalVotosValidos),
            votosFaltanPreciso: Math.round(pVpa * paf)
          });
        }
      }
    }
    console.log(`  EXTRANJERO OK (${paises.length} paises)`);

    departamentos.push({
      nombre: 'EXTRANJERO', ubigeo: '999999',
      totales: extTotals.data,
      candidatos: (extCands?.data || []).sort((a, b) => b.totalVotosValidos - a.totalVotosValidos),
      provincias: paises,
      votosFaltanPreciso: ac > 0 ? Math.round(extVpa * af) : 0
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
