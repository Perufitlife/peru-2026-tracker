"""Identifica qué candidato es P1, P2, ..., P18 en 1ra vuelta 2021 sumando votos nacionales"""
import csv
from collections import defaultdict

CSV = "forensic_2021/Resultados_1ra_vuelta_Version_PCM.csv"
sums = defaultdict(int)
with open(CSV, "r", encoding="latin-1") as f:
    rd = csv.DictReader(f, delimiter=";")
    for row in rd:
        if row["DESCRIP_ESTADO_ACTA"].strip() != "CONTABILIZADA":
            continue
        for i in range(1, 19):
            try:
                sums[f"P{i}"] += int(row[f"VOTOS_P{i}"])
            except Exception:
                pass

print("Totales por columna P1..P18:")
items = sorted(sums.items(), key=lambda x: -x[1])
for col, votos in items:
    print(f"  {col}: {votos:,}")

print("\nMapeo esperado (oficial ONPE 2021 1V votos válidos):")
expected = [
    ("Castillo (PL)", 2_724_758),
    ("Keiko (FP)", 1_930_762),
    ("López Aliaga (RP)", 1_692_279),
    ("De Soto (Avanza)", 1_675_162),
    ("Lescano (AP)", 1_309_610),
    ("Mendoza (JP)", 1_140_952),
    ("George Forsyth (Victoria)", 805_678),
    ("Daniel Salaverry (Somos Perú)", 627_407),
    ("Daniel Urresti (Podemos)", 826_595),
    ("Julio Guzmán (Morado)", 332_178),
    ("Ollanta Humala (PNP)", 222_117),
    ("Marco Arana (FAP)", 175_376),
    ("Cesar Acuña (APP)", 868_115),
    ("Rafael Santos (PP)", 96_708),
    ("Andres Alcantara (PD)", 60_120),
    ("Jose Vega (Unión Por el Perú)", 99_478),
    ("Ciro Galvez (Renacimiento Unido)", 124_034),
    ("Alberto Beingolea (PPC)", 287_590),
]
expected.sort(key=lambda x: -x[1])
for name, v in expected:
    print(f"  {name}: {v:,}")
