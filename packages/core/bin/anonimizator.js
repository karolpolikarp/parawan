#!/usr/bin/env node
/**
 * CLI anonimizatora: czyta tekst z plików lub stdin, pisze zredagowany tekst na stdout.
 * Statystyki (co zamaskowano) idą na stderr, żeby nie mieszać ich z wynikiem w potokach.
 *
 *   anonimizator plik.txt                # wynik na stdout
 *   anonimizator plik.txt --out czysty.txt
 *   type dokument.txt | anonimizator     # (Windows) stdin → stdout
 *   cat dokument.txt | anonimizator      # (Linux/macOS)
 *   anonimizator plik.txt --cicho        # bez statystyk na stderr
 *   anonimizator --jsonl --bez-tekstu    # most dla wywolan programowych, patrz nizej
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import process from 'node:process';
import { redactPII, describeFindings } from '../dist/index.js';

const HELP = `anonimizator — lokalna redakcja polskich danych osobowych (PII)

Użycie:
  anonimizator [plik...]           zredaguj pliki, wynik na stdout
  anonimizator --out wynik.txt     zapisz wynik do pliku zamiast stdout
  anonimizator --osoby             rozróżniaj osoby: [OSOBA-A], [OSOBA-B]…
  anonimizator --cicho             nie wypisuj statystyk na stderr
  anonimizator --jsonl             tryb mostu: stdin/stdout linia-po-linii, patrz niżej
  anonimizator --bez-tekstu        z --jsonl: nie odsyłaj zredagowanego tekstu
  anonimizator --help              ta pomoc

Bez argumentów czyta ze stdin. Nic nie jest wysyłane przez sieć —
cała redakcja odbywa się lokalnie.

Tryb --jsonl (dla wywołań programowych, proces trwały):
  na stdin jedna linia JSON na tekst:  {"id": 0, "text": "..."}
  na stdout jedna linia JSON na odpowiedź, w tej samej kolejności:
    {"id": 0, "found": [{"type": "PESEL", "count": 1}, ...]}
    (albo {"id": 0, "redacted": "...", "found": [...]} bez --bez-tekstu)
  Proces kończy się, gdy stdin się zamknie. Brak obsługi tego trybu w starszych
  wydaniach kończy się natychmiast kodem wyjścia 2 (nieznana opcja) — to jest
  celowo wykorzystywane jako sonda wersji po drugiej stronie mostu.`;

// Odmiana liczebnika: 1 wystąpienie, 2–4 (poza 12–14) wystąpienia, reszta wystąpień.
function plural(n, one, few, many) {
  if (n === 1) return one;
  const d = n % 10;
  const h = n % 100;
  return d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
}

const args = process.argv.slice(2);
const files = [];
let outPath = null;
let quiet = false;
let pseudonyms = false;
let jsonl = false;
let bezTekstu = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--help' || a === '-h') {
    console.log(HELP);
    process.exit(0);
  } else if (a === '--out' || a === '-o') {
    outPath = args[++i];
    if (!outPath) {
      console.error('Błąd: --out wymaga ścieżki pliku.');
      process.exit(2);
    }
  } else if (a === '--cicho' || a === '-q' || a === '--quiet') {
    quiet = true;
  } else if (a === '--osoby' || a === '--pseudonimy') {
    pseudonyms = true;
  } else if (a === '--jsonl') {
    jsonl = true;
  } else if (a === '--bez-tekstu') {
    bezTekstu = true;
  } else if (a.startsWith('-')) {
    console.error(`Nieznana opcja: ${a}\n`);
    console.error(HELP);
    process.exit(2);
  } else {
    files.push(a);
  }
}

if (jsonl) {
  // Most dla wywolan programowych (patrz generator/quality/pii.py w pl-urzed-synth):
  // proces trwaly, jedna linia JSON na wejsciu = jedna linia JSON na wyjsciu, w TEJ
  // SAMEJ kolejnosci. Bez tego kazde wywolanie placiloby za start interpretera Node.
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (linia) => {
    if (!linia.trim()) return;
    // Zly wiersz nie moze zabic procesu trwalego: odpowiadamy linia z "error" (kolejnosc
    // odpowiedzi zostaje 1:1 z wejsciem), a id oddajemy, jesli dalo sie je odczytac.
    let id = null;
    try {
      const wejscie = JSON.parse(linia);
      id = wejscie?.id ?? null;
      const text = wejscie?.text ?? '';
      if (typeof text !== 'string') throw new TypeError('pole "text" musi być napisem');
      const { redacted, found } = redactPII(text, { pseudonyms });
      const odpowiedz = bezTekstu ? { id, found } : { id, redacted, found };
      process.stdout.write(JSON.stringify(odpowiedz) + '\n');
    } catch (err) {
      process.stdout.write(JSON.stringify({ id, error: err.message }) + '\n');
    }
  });
  rl.on('close', () => process.exit(0));
  // Skrypt konczy sie razem z zamknieciem stdin (most zamyka je jawnie po stronie
  // Pythona) - nic wiecej nie musi trzymac petli zdarzen przy zyciu.
} else {
  glowna();
}

function glowna() {
  // BOM (﻿) zdejmujemy: pliki UTF-8 zapisane na Windows (np. przez Out-File)
  // zaczynają się od niego, a nie jest treścią.
  const stripBom = (s) => s.replace(/^﻿/, '');

  let input;
  try {
    input = files.length > 0
      ? files.map((f) => stripBom(readFileSync(f, 'utf8'))).join('\n')
      : stripBom(readFileSync(0, 'utf8')); // stdin
  } catch (err) {
    console.error(`Błąd odczytu: ${err.message}`);
    process.exit(1);
  }

  const { redacted, found } = redactPII(input, { pseudonyms });

  if (outPath) {
    writeFileSync(outPath, redacted, 'utf8');
  } else {
    process.stdout.write(redacted);
  }

  if (!quiet) {
    if (found.length === 0) {
      console.error('Nie wykryto danych osobowych.');
    } else {
      const total = found.reduce((s, f) => s + f.count, 0);
      console.error(`Zamaskowano ${total} ${plural(total, 'wystąpienie', 'wystąpienia', 'wystąpień')}: ${describeFindings(found).join(', ')}.`);
    }
  }
}
