#!/usr/bin/env node
// Polecenie parawan = CLI z paczki anonimizator (te same opcje, ten sam wynik).
// Paczka anonimizator nie eksportuje swojego bin, więc szukamy go obok jej dist/index.js
// i importujemy po ścieżce pliku (adres file:// omija mapę exports).
const wejscie = new URL(import.meta.resolve('anonimizator'));
await import(new URL('../bin/anonimizator.js', wejscie).href);
