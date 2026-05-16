"""
Forensic 2021 2da vuelta: Keiko (P1=Fuerza Popular) vs Castillo (P2=Peru Libre)
Output: por provincia => votos K, votos C, margen, electores, participacion, % por candidato
"""
import csv
import json
from collections import defaultdict

CSV_PATH = "forensic_2021/Resultados_2da_vuelta_Version_PCM .csv"

prov = defaultdict(lambda: {
    "departamento": "",
    "provincia": "",
    "votos_K": 0,    # Keiko (P1 en CSV)
    "votos_C": 0,    # Castillo (P2)
    "vb": 0,         # blancos
    "vn": 0,         # nulos
    "vi": 0,         # impugnados
    "habiles": 0,    # electores habiles (sum mesas)
    "mesas": 0,
})

dep_totals = defaultdict(lambda: {"K": 0, "C": 0, "habiles": 0, "vb": 0, "vn": 0})

def to_int(s):
    if s is None or s == "" or s == "-":
        return 0
    try:
        return int(s)
    except Exception:
        return 0

with open(CSV_PATH, "r", encoding="latin-1") as f:
    reader = csv.DictReader(f, delimiter=";")
    for row in reader:
        if row["DESCRIP_ESTADO_ACTA"].strip() != "CONTABILIZADA":
            continue
        # ubigeo provincia = first 4 digits
        ubigeo_dist = row["UBIGEO"].strip('"').strip()
        ubigeo_prov = ubigeo_dist[:4]
        dep = row["DEPARTAMENTO"].strip().strip('"')
        provincia = row["PROVINCIA"].strip().strip('"')
        key = ubigeo_prov

        p = prov[key]
        p["departamento"] = dep
        p["provincia"] = provincia
        # CSV: P1=CASTILLO (Perú Libre), P2=KEIKO (Fuerza Popular)
        p["votos_K"] += to_int(row["VOTOS_P2"])
        p["votos_C"] += to_int(row["VOTOS_P1"])
        p["vb"] += to_int(row["VOTOS_VB"])
        p["vn"] += to_int(row["VOTOS_VN"])
        p["vi"] += to_int(row["VOTOS_VI"])
        p["habiles"] += to_int(row["N_ELEC_HABIL"])
        p["mesas"] += 1

        d = dep_totals[dep]
        d["K"] += to_int(row["VOTOS_P2"])
        d["C"] += to_int(row["VOTOS_P1"])
        d["habiles"] += to_int(row["N_ELEC_HABIL"])
        d["vb"] += to_int(row["VOTOS_VB"])
        d["vn"] += to_int(row["VOTOS_VN"])

# build output
out = {"provincias": [], "departamentos": [], "nacional": {}}
nacional = {"K": 0, "C": 0, "habiles": 0, "vb": 0, "vn": 0, "vi": 0}

for key, p in prov.items():
    validos = p["votos_K"] + p["votos_C"]
    if validos == 0:
        continue
    emitidos = validos + p["vb"] + p["vn"] + p["vi"]
    pct_K = p["votos_K"] / validos * 100
    pct_C = p["votos_C"] / validos * 100
    margen = p["votos_K"] - p["votos_C"]
    out["provincias"].append({
        "ubigeo": key,
        "departamento": p["departamento"],
        "provincia": p["provincia"],
        "votos_K": p["votos_K"],
        "votos_C": p["votos_C"],
        "validos": validos,
        "emitidos": emitidos,
        "habiles": p["habiles"],
        "vb": p["vb"],
        "vn": p["vn"],
        "pct_K": round(pct_K, 2),
        "pct_C": round(pct_C, 2),
        "margen": margen,
        "ganador": "K" if margen > 0 else "C",
        "mesas": p["mesas"],
    })
    nacional["K"] += p["votos_K"]
    nacional["C"] += p["votos_C"]
    nacional["vb"] += p["vb"]
    nacional["vn"] += p["vn"]
    nacional["vi"] += p["vi"]
    nacional["habiles"] += p["habiles"]

for dep, d in dep_totals.items():
    validos = d["K"] + d["C"]
    if validos == 0:
        continue
    out["departamentos"].append({
        "departamento": dep,
        "votos_K": d["K"],
        "votos_C": d["C"],
        "validos": validos,
        "pct_K": round(d["K"]/validos*100, 2),
        "pct_C": round(d["C"]/validos*100, 2),
        "margen": d["K"] - d["C"],
        "ganador": "K" if d["K"] > d["C"] else "C",
        "habiles": d["habiles"],
    })

nat_validos = nacional["K"] + nacional["C"]
out["nacional"] = {
    "K": nacional["K"],
    "C": nacional["C"],
    "validos": nat_validos,
    "pct_K": round(nacional["K"]/nat_validos*100, 4),
    "pct_C": round(nacional["C"]/nat_validos*100, 4),
    "margen": nacional["K"] - nacional["C"],
    "habiles": nacional["habiles"],
}

# sort provs by margen pro-Castillo (biggest losses first for Keiko)
out["provincias"].sort(key=lambda x: x["margen"])
out["departamentos"].sort(key=lambda x: x["margen"])

with open("forensic_2021_provincias.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

print(f"Nacional 2da vuelta 2021:")
print(f"  Keiko: {nacional['K']:,} ({out['nacional']['pct_K']}%)")
print(f"  Castillo: {nacional['C']:,} ({out['nacional']['pct_C']}%)")
print(f"  Margen: {out['nacional']['margen']:,}")
print(f"  Provincias: {len(out['provincias'])}")
print(f"\nTop 15 provincias donde Keiko PERDIÓ MAS:")
print(f"{'Provincia':<30} {'Depto':<15} {'%K':>6} {'%C':>6} {'Margen':>10} {'Validos':>10}")
for p in out["provincias"][:15]:
    print(f"{p['provincia']:<30} {p['departamento']:<15} {p['pct_K']:>6} {p['pct_C']:>6} {p['margen']:>10,} {p['validos']:>10,}")

print(f"\nTop 15 provincias donde Keiko GANO MAS:")
for p in out["provincias"][-15:][::-1]:
    print(f"{p['provincia']:<30} {p['departamento']:<15} {p['pct_K']:>6} {p['pct_C']:>6} {p['margen']:>10,} {p['validos']:>10,}")
