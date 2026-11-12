#!/usr/bin/env python3
"""Porównuje wyniki anonimizatora z kluczem (ground_truth/*.json).

Użycie:
    python eval.py WYNIKI_DIR [--gt ground_truth] [--report raport]

WYNIKI_DIR zawiera zanonimizowane pliki o tych samych nazwach co wejście
(np. 01_wniosek_urzad.txt, .docx, .md lub .html). Wystarczy zgodny początek
nazwy, np. 01_wniosek_urzad_anon.txt też zostanie dopasowany.

Wynik: raport.md (czytelny) i raport.json (do dalszej analizy).
"""
import argparse, collections, glob, json, os, re, sys

def read_output(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".docx":
        try:
            import docx
        except ImportError:
            sys.exit("Brak python-docx: pip install python-docx")
        d = docx.Document(path)
        parts = [p.text for p in d.paragraphs]
        for t in d.tables:
            for row in t.rows:
                parts.extend(c.text for c in row.cells)
        return "\n".join(parts)
    txt = open(path, encoding="utf-8", errors="replace").read()
    if ext in (".html", ".htm"):
        txt = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", txt, flags=re.I)
        txt = re.sub(r"<br\s*/?>|</p>|</div>|</li>", "\n", txt, flags=re.I)
        txt = re.sub(r"<[^>]+>", "", txt)
        import html; txt = html.unescape(txt)
    return txt

def count(text, needle):
    return len(re.findall(r"(?<!\w)" + re.escape(needle) + r"(?!\w)", text))

DIGIT_TYPES = {"PESEL", "NIP_PERSON", "REGON_PERSON", "IBAN", "PHONE", "FAKE_PESEL", "PROF_ID"}
def digits_leak(text, needle):
    """Wyciek po zmianie formatu: te same cyfry bez spacji i myślników w jednej linii."""
    d = re.sub(r"\D", "", needle)
    if len(d) < 7: return False
    for line in text.splitlines():
        if d in re.sub(r"[\s\-()+./]", "", line.replace("PL", "")): return True
    return False

PLACEHOLDER = re.compile(r"\[[^\[\]\n]{2,40}\]|<[A-ZĄĆĘŁŃÓŚŹŻ_\-]{2,30}(?:[-_]\d+)?>|\{\{[^{}]+\}\}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir"); ap.add_argument("--gt", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "ground_truth"))
    ap.add_argument("--report", default="raport")
    a = ap.parse_args()

    outs = sorted(glob.glob(os.path.join(a.out_dir, "*")))
    by_type = collections.defaultdict(lambda: {"occ": 0, "leaked": 0, "items": 0, "items_leaked": 0})
    by_tpl = collections.defaultdict(lambda: {"occ": 0, "leaked": 0, "over": 0, "keep_occ": 0})
    keep_type = collections.defaultdict(lambda: {"occ": 0, "removed": 0})
    policy = collections.defaultdict(lambda: {"occ": 0, "kept": 0})
    leaks, overs, missing, docs = [], [], [], []
    numbered = plain = 0

    for gtf in sorted(glob.glob(os.path.join(a.gt, "*.json"))):
        gt = json.load(open(gtf, encoding="utf-8")); sid = gt["id"]
        cand = [p for p in outs if os.path.basename(p).startswith(sid)]
        if not cand: missing.append(sid); continue
        out = read_output(cand[0]); tpl = gt["template"]
        doc = {"id": sid, "file": os.path.basename(cand[0]), "leaks": [], "over": [], "policy": []}
        for ph in PLACEHOLDER.findall(out):
            if re.search(r"\d", ph): numbered += 1
            else: plain += 1
        for e in gt["entities"]:
            n0 = e["count"]; n1 = count(out, e["text"])
            if e["expect"] == "mask":
                left = n1
                reformatted = n1 == 0 and e["type"] in DIGIT_TYPES and digits_leak(out, e["text"])
                t = by_type[e["type"]]; t["occ"] += n0; t["items"] += 1
                by_tpl[tpl]["occ"] += n0
                if left or reformatted:
                    leaked = min(left, n0) if left else n0
                    t["leaked"] += leaked; t["items_leaked"] += 1; by_tpl[tpl]["leaked"] += leaked
                    rec = {"doc": sid, "type": e["type"], "text": e["text"], "orig": n0, "left": left, "note": e.get("note", ""),
                           "how": "inny format tych samych cyfr" if reformatted else ("częściowo" if left < n0 else "w całości")}
                    leaks.append(rec); doc["leaks"].append(rec)
            elif e["expect"] == "keep":
                k = keep_type[e["type"]]; k["occ"] += n0; by_tpl[tpl]["keep_occ"] += n0
                if n1 < n0:
                    k["removed"] += n0 - n1; by_tpl[tpl]["over"] += n0 - n1
                    rec = {"doc": sid, "type": e["type"], "text": e["text"], "orig": n0, "left": n1, "note": e.get("note", "")}
                    overs.append(rec); doc["over"].append(rec)
            else:
                p = policy[e["type"]]; p["occ"] += n0; p["kept"] += min(n1, n0)
                doc["policy"].append({"type": e["type"], "text": e["text"], "orig": n0, "left": n1})
        docs.append(doc)

    if not docs: sys.exit(f"Nie znaleziono plików wynikowych w {a.out_dir}")
    tot_occ = sum(t["occ"] for t in by_type.values()); tot_leak = sum(t["leaked"] for t in by_type.values())
    keep_occ = sum(k["occ"] for k in keep_type.values()); keep_rm = sum(k["removed"] for k in keep_type.values())
    recall = 1 - tot_leak / tot_occ if tot_occ else 0

    L = [f"# Raport anonimizacji", "",
         f"Ocenione pisma: {len(docs)} z {len(docs)+len(missing)}" + (f" (brak wyników: {', '.join(missing)})" if missing else ""), "",
         f"Skuteczność maskowania (recall, wystąpienia): **{recall:.1%}** ({tot_occ-tot_leak}/{tot_occ}), wycieki: {tot_leak}",
         f"Nadmiarowe maskowanie (elementy do zachowania usunięte): {keep_rm}/{keep_occ}",
         f"Znaczniki w wyniku: {numbered} numerowanych, {plain} bez numeru", "",
         "## Wycieki wg typu danych", "", "| typ | wystąpienia | wycieki | recall | encje z wyciekiem |", "|---|---:|---:|---:|---:|"]
    for k, t in sorted(by_type.items(), key=lambda x: (-x[1]["leaked"], x[0])):
        L.append(f"| {k} | {t['occ']} | {t['leaked']} | {1-t['leaked']/t['occ']:.0%} | {t['items_leaked']}/{t['items']} |")
    L += ["", "## Wyniki wg typu pisma", "", "| szablon | recall | wycieki | nadmiarowo usunięte |", "|---|---:|---:|---:|"]
    for k, t in sorted(by_tpl.items()):
        L.append(f"| {k} | {1-t['leaked']/t['occ']:.0%} | {t['leaked']} | {t['over']}/{t['keep_occ']} |")
    L += ["", "## Nadmiarowe maskowanie wg typu", "", "| typ | do zachowania | usunięte |", "|---|---:|---:|"]
    for k, t in sorted(keep_type.items()):
        L.append(f"| {k} | {t['occ']} | {t['removed']} |")
    L += ["", "## Decyzje polityki (bez oceny, informacyjnie)", "", "| typ | wystąpienia | pozostawione |", "|---|---:|---:|"]
    for k, t in sorted(policy.items()):
        L.append(f"| {k} | {t['occ']} | {t['kept']} |")
    L += ["", "## Lista wycieków", ""]
    for r in leaks:
        L.append(f"- {r['doc']} | {r['type']} | `{r['text']}` | {r['how']} ({r['left']}/{r['orig']})" + (f" | {r['note']}" if r['note'] else ""))
    L += ["", "## Lista nadmiarowo zamaskowanych", ""]
    for r in overs:
        L.append(f"- {r['doc']} | {r['type']} | `{r['text']}` ({r['left']}/{r['orig']} zostało)" + (f" | {r['note']}" if r['note'] else ""))

    open(a.report + ".md", "w", encoding="utf-8").write("\n".join(L) + "\n")
    json.dump({"recall": recall, "leaks_total": tot_leak, "mask_occurrences": tot_occ, "over_redacted": keep_rm, "keep_occurrences": keep_occ,
               "placeholders": {"numbered": numbered, "plain": plain}, "by_type": by_type, "by_template": by_tpl,
               "keep_by_type": keep_type, "policy": policy, "leaks": leaks, "over_redacted_items": overs, "docs": docs, "missing": missing},
              open(a.report + ".json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"recall {recall:.1%} | wycieki {tot_leak} | nadmiarowe {keep_rm} | raport: {a.report}.md")

if __name__ == "__main__":
    main()
