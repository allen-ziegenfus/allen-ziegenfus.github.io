#!/usr/bin/env python3
"""Archive -> one CSV per Google Sheet tab.

Flattens Airtable's nested records into the rows a spreadsheet can hold.

There is no image column. Images are found by convention: `<slug>-NN.<ext>` in the
Werkgruppe's folder, where <slug> is the site's own slugify of the inventory number.
An earlier draft used an explicit `Bilder` column on the assumption that inventory
numbers containing dots, slashes and hyphenated ranges would collide under a
convention. Measured across all 2,144 works: zero duplicate slugs, zero prefix
collisions. The assumption was wrong and the column was removed - adding an image is
now "drop a correctly named file in the folder", with no edit to the sheet at all.
"""
import csv, json, os, sys

EXPORT = sys.argv[1] if len(sys.argv) > 1 else "../werkverzeichnis-export"
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(EXPORT, "sheets")
META, ORIG = os.path.join(EXPORT, "metadata"), os.path.join(EXPORT, "originals")

# The canonical column set, in the order an editor should see them.
COLUMNS = ["Inv. Nr.", "Titel", "Werkgruppe", "Jahr", "Maße", "Material", "Technik",
           "Beschreibung", "Zustand", "Standort", "Signatur", "Auflage", "Anzahl",
           "Foto", "Ausstellung", "Literatur", "Bibliographie"]

os.makedirs(OUT, exist_ok=True)
covers = {c["werkgruppe"]: c for c in json.load(open(os.path.join(ORIG, "covers.json")))}
groups = json.load(open(os.path.join(META, "_werkgruppen.json")))
groups.sort(key=lambda g: int(g["Reihenfolge"] or 999))

summary = []
for g in groups:
    rows = []
    for r in json.load(open(os.path.join(META, g["Slug"] + ".json"))):
        f = r["fields"]
        if not f.get("Inv. Nr."):
            continue
        rows.append({c: (f.get(c) or "") for c in COLUMNS})

    path = os.path.join(OUT, g["Slug"] + ".csv")
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS)
        w.writeheader(); w.writerows(rows)
    summary.append((g["Slug"], len(rows), os.path.getsize(path)))

# the Übersicht tab: which groups exist, in what order, with their cover image
with open(os.path.join(OUT, "_Übersicht.csv"), "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["Slug", "Titel", "Kurztitel", "Reihenfolge", "Tab", "Bild"])
    for g in groups:
        cov = covers.get(g["Slug"])
        w.writerow([g["Slug"], g["Titel"], g.get("Kurztitel") or "", g["Reihenfolge"],
                    g["Slug"], os.path.basename(cov["file"]) if cov else ""])

# the Seiten tabs: static prose, one row per paragraph block
seiten = json.load(open(os.path.join(META, "_seiten.json")))
with open(os.path.join(OUT, "_Seiten.csv"), "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["Tab", "Reihenfolge", "Kategorie"])
    for p in seiten["index"]:
        if p.get("Table"):
            w.writerow([p["Table"], p.get("Reihenfolge", ""), p.get("Kategorie", "")])
for name, recs in seiten["tables"].items():
    cols, seen = [], set()
    for r in recs:
        for k in r["fields"]:
            if k not in seen:
                seen.add(k); cols.append(k)
    with open(os.path.join(OUT, "seite_%s.csv" % name.replace("/", "_")), "w",
              newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for r in recs:
            w.writerow({c: r["fields"].get(c, "") for c in cols})

print("%-24s %6s %10s" % ("TAB", "ROWS", "BYTES"))
print("-" * 44)
for slug, n, size in summary:
    print("%-24s %6d %10d" % (slug, n, size))
print("-" * 44)
print("%-24s %6d" % ("TOTAL", sum(n for _, n, _ in summary)))
print("\nplus _Übersicht.csv, _Seiten.csv and %d seite_*.csv" % len(seiten["tables"]))
