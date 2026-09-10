#!/usr/bin/env python3
"""Compare two werkgruppen.json builds field by field.

Verification for a data-source swap. Deliberately independent of both generators: it
re-derives the comparison from the outputs alone and shares no code with either, so it
cannot repeat the mistake of validating an index against itself.

  python3 tools/diff_artifacts.py /tmp/from-airtable.json public/werkgruppen.json
"""
import json, sys

IGNORE = {"id"}          # Airtable record id has no spreadsheet equivalent

a_path, b_path = sys.argv[1], sys.argv[2]
A, B = json.load(open(a_path)), json.load(open(b_path))
idx = lambda doc: {(g["Slug"], r["Slug"]): r for g in doc for r in g["Records"]}
L, R = idx(A), idx(B)

only_l, only_r = sorted(set(L) - set(R)), sorted(set(R) - set(L))
diffs, checked = [], 0
for k in sorted(set(L) & set(R)):
    x, y = L[k], R[k]
    for f in sorted((set(x) | set(y)) - IGNORE):
        checked += 1
        if x.get(f) != y.get(f):
            diffs.append((k, f, x.get(f), y.get(f)))

print(f"{a_path}: {len(L)} works")
print(f"{b_path}: {len(R)} works")
print(f"records compared: {len(set(L) & set(R))}   fields compared: {checked}")
print(f"field differences: {len(diffs)}")
for k, f, x, y in diffs[:25]:
    print(f"  {k[0]}/{k[1]:14} {f:14} A={x!r:32.32} B={y!r:.32}")

if only_l:
    print(f"\nonly in A ({len(only_l)}):")
    for k in only_l[:10]:
        print(f"  {k[0]}/{k[1]}")
if only_r:
    print(f"\nonly in B ({len(only_r)}):")
    for k in only_r[:10]:
        print(f"  {k[0]}/{k[1]}")

print("\ngroup-level:")
gl = 0
for x, y in zip(A, B):
    for f in ("Titel", "Slug", "Thumbnail", "Reihenfolge", "Kurztitel", "Count"):
        if x.get(f) != y.get(f):
            gl += 1
            print(f"  {x['Slug']:22} {f:12} A={x.get(f)!r}  B={y.get(f)!r}")
if not gl:
    print("  identical")

sys.exit(1 if diffs else 0)
