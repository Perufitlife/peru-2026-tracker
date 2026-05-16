"""
2021 1ra vuelta — bloques ideológicos por distrito.

Mapeo verificado empíricamente:
  P16 = Pedro Castillo (PL)           — izquierda
  P11 = Keiko Fujimori (FP)           — derecha
  P13 ≈ Rafael López Aliaga (RP)      — derecha
  P7  ≈ Hernando de Soto (Avanza)     — derecha (econ)
  P18 ≈ Cesar Acuña (APP)             — centro-derecha
  P5  ≈ Daniel Urresti (Podemos)      — derecha
  P8  ≈ George Forsyth (Victoria)     — centro
  P6  ≈ Yonhy Lescano (AP)            — centro
  P9  ≈ Verónika Mendoza (JP)         — izquierda
  P3  ≈ Julio Guzmán (Morado)         — centro
  P10 ≈ Alberto Beingolea (PPC)       — derecha
  P1  ≈ Ollanta Humala (PNP)          — izq nacionalista
  P15 ≈ Marco Arana (FAP)             — izquierda
  P12 ≈ Rafael Santos (PP)            — derecha
  P14 ≈ Ciro Galvez (RU)              — derecha andina
  P2  ≈ Andrés Alcántara (PD)         — sin bloque claro
  P4  ≈ ?                              — chico
  P17 ≈ ?                              — chico

Salida JSON:
{
  "distritos": [{ubigeo, dep, prov, dist,
    castillo, izquierda_total, derecha_total, centro_total, validos,
    pct_castillo, pct_izq, pct_der, pct_centro, blanco_nulo}]
}
"""
import csv
import json
from collections import defaultdict

CSV = "forensic_2021/Resultados_1ra_vuelta_Version_PCM.csv"

# Bloques ideológicos (mapeo verificado empíricamente)
BLOQUES = {
    "castillo":   ["P16"],
    "izquierda_otros": ["P9", "P15", "P1"],          # Mendoza, Arana, Humala
    "centro":     ["P6", "P8", "P3"],                # Lescano, Forsyth, Guzmán
    "keiko":      ["P11"],
    "derecha_otros": ["P13", "P7", "P18", "P5", "P10", "P12"],  # LA, De Soto, Acuña, Urresti, Beingolea, Santos
    "otros":      ["P2", "P4", "P14", "P17"],
}

distritos = defaultdict(lambda: {
    "departamento": "", "provincia": "", "distrito": "",
    "vb": 0, "vn": 0, "vi": 0, "habiles": 0,
    **{k: 0 for k in BLOQUES.keys()}
})

def to_int(s):
    if s is None or s == "" or s == "-":
        return 0
    try:
        return int(s)
    except:
        return 0

with open(CSV, "r", encoding="latin-1") as f:
    rd = csv.DictReader(f, delimiter=";")
    for row in rd:
        if row["DESCRIP_ESTADO_ACTA"].strip() != "CONTABILIZADA":
            continue
        ubigeo = row["UBIGEO"].strip('"').strip()
        dep = row["DEPARTAMENTO"].strip().strip('"')
        prov = row["PROVINCIA"].strip().strip('"')
        dist = row["DISTRITO"].strip().strip('"')
        d = distritos[ubigeo]
        d["departamento"] = dep
        d["provincia"] = prov
        d["distrito"] = dist
        d["vb"] += to_int(row["VOTOS_VB"])
        d["vn"] += to_int(row["VOTOS_VN"])
        d["vi"] += to_int(row["VOTOS_VI"])
        d["habiles"] += to_int(row["N_ELEC_HABIL"])
        for bloque, cols in BLOQUES.items():
            for col in cols:
                d[bloque] += to_int(row[f"VOTOS_{col}"])

out = {"distritos": []}
nacional = {k: 0 for k in BLOQUES.keys()}
nacional.update({"vb": 0, "vn": 0, "habiles": 0})

for ubigeo, d in distritos.items():
    validos = sum(d[k] for k in BLOQUES.keys())
    if validos == 0:
        continue
    row_out = {
        "ubigeo": ubigeo,
        "departamento": d["departamento"],
        "provincia": d["provincia"],
        "distrito": d["distrito"],
        "validos": validos,
        "habiles": d["habiles"],
        "vb": d["vb"],
        "vn": d["vn"],
    }
    for bloque in BLOQUES.keys():
        row_out[f"v_{bloque}"] = d[bloque]
        row_out[f"pct_{bloque}"] = round(d[bloque] / validos * 100, 2)
        nacional[bloque] += d[bloque]
    # Derivados clave
    izq_total = d["castillo"] + d["izquierda_otros"]
    der_total = d["keiko"] + d["derecha_otros"]
    centro = d["centro"]
    row_out["pct_izq_total"] = round(izq_total / validos * 100, 2)
    row_out["pct_der_total"] = round(der_total / validos * 100, 2)
    row_out["pct_centro_total"] = round(centro / validos * 100, 2)
    out["distritos"].append(row_out)
    nacional["vb"] += d["vb"]
    nacional["vn"] += d["vn"]
    nacional["habiles"] += d["habiles"]

# resumen nacional
total_validos = sum(nacional[k] for k in BLOQUES.keys())
print("=== 2021 1V — Nacional ===")
for bloque in BLOQUES.keys():
    pct = nacional[bloque] / total_validos * 100
    print(f"  {bloque:<20} {nacional[bloque]:>12,}  {pct:>6.2f}%")
print(f"  total_validos: {total_validos:,}")
print(f"  vb (blancos): {nacional['vb']:,}")
print(f"  vn (nulos):   {nacional['vn']:,}")

izq = nacional["castillo"] + nacional["izquierda_otros"]
der = nacional["keiko"] + nacional["derecha_otros"]
ctr = nacional["centro"]
print(f"\nBloques agregados:")
print(f"  izquierda total: {izq:,}  ({izq/total_validos*100:.2f}%)")
print(f"  derecha total:   {der:,}  ({der/total_validos*100:.2f}%)")
print(f"  centro total:    {ctr:,}  ({ctr/total_validos*100:.2f}%)")

print(f"\nTotal distritos 2021 1V: {len(out['distritos'])}")

with open("forensic_2021_1v_distritos.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print("✅ forensic_2021_1v_distritos.json escrito")
