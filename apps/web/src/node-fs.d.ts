// Testy treści CSS czytają arkusz z dysku, bo vitest podaje import „style.css?raw” jako pusty
// napis. Pełne @types/node wpuściłyby do typów aplikacji przeglądarkowej Buffer i process, więc
// deklarujemy tylko tę jedną funkcję. Kod aplikacji node:fs nie importuje (pilnuje markup.test.ts).
declare module 'node:fs' {
  export function readFileSync(path: URL | string, encoding: 'utf8'): string;
  // bez kodowania Node zwraca Buffer, czyli Uint8Array (fikcyjne pisma .docx w testach)
  export function readFileSync(path: URL | string): Uint8Array;
}
