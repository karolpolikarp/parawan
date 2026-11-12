# anonimizator

Lokalna redakcja polskich danych osobowych (PII) w tekście. Zero zależności, działa w Node,
Deno, Bun i przeglądarce. Zamienia na neutralne znaczniki (`[PESEL]`, `[EMAIL]`…) ponad 20 typów
danych z pięciu grup:

- **osoby:** imię i nazwisko, data urodzenia;
- **kontakt:** e-mail, telefon;
- **adres:** ulica z numerem, kod pocztowy, miejscowość;
- **identyfikatory:** m.in. PESEL, NIP, REGON, KRS, numer KSeF, dowód, paszport, prawo jazdy,
  nr rejestracyjny, VIN, adres IP i MAC, token, login, znak sprawy;
- **finanse:** numer konta (IBAN), karta płatnicza.

Pełna lista z metodą wykrywania każdego typu: [tabela „Co wykrywa”](https://github.com/karolpolikarp/parawan#-co-wykrywa).

Tam, gdzie format ma sumę kontrolną (PESEL, NIP, REGON, IBAN, dowód, karta), jest ona
**walidowana**, więc przypadkowe ciągi cyfr (numery przepisów, cytowane sygnatury orzeczeń) nie są maskowane.
Redakcja jest idempotentna.

```bash
npm install anonimizator
```

CLI bez instalacji: `npx anonimizator pismo.txt --out czysty.txt` (opcje: `npx anonimizator --help`).

```ts
import { redactPII } from 'anonimizator';

const { redacted, found } = redactPII('Mój PESEL to 44051401359, mail jan@example.com');
// redacted → 'Mój PESEL to [PESEL], mail [EMAIL]'
// found    → [{ type: 'EMAIL', count: 1 }, { type: 'PESEL', count: 1 }]
//            (kolejność elementów found nie jest częścią kontraktu)
```

Własne znaczniki podaje opcja `masks`, np. `redactPII(tekst, { masks: { IMIE: '[OSOBA]' } })`.
Własne znaczniki są podstawiane na końcu, po wykryciu, więc nie wpływają na to, co zostanie
zamaskowane: wynik to wynik domyślny z innym tekstem znaczników. Znacznik może być pusty albo
wspólny dla kilku typów. Bez cyfr i „@” ponowny przebieg nie weźmie go za dane osobowe, ale
znacznika pustego albo z samej interpunkcji ponowny przebieg nie rozpozna jako maski.

**Ograniczenie:** wykrywanie imion i nazwisk warstwą podstawową jest heurystyczne (słownik
imion i nazwisk, morfologia, wyzwalacze kontekstu), więc zawsze przejrzyj wynik przed
udostępnieniem. Recall rzadkich nazwisk podnosi opcjonalna lokalna usługa NER z dodatku
[anonimizator-ai](https://github.com/karolpolikarp/anonimizator-ai). Jest fail-safe: jej awaria
nigdy nie obniża ochrony poniżej warstwy regex.

```ts
import { redactPIIFull } from 'anonimizator/ner';

const { redacted } = await redactPIIFull(tekst, { url: 'http://127.0.0.1:8090' });
```

## Budowa

`redactPII` to orkiestrator (`src/redact.ts`), który woła kolejno kilkadziesiąt przebiegów
z `src/passes/`: najpierw ochrona URL-i, potem dane z etykietą lub wzorcem, numery z sumą
kontrolną, adresy i miejscowości, na końcu osoby. Kolejność ma znaczenie, bo późniejsze przebiegi
czytają placeholdery wcześniejszych. Przebiegi nie importują się nawzajem poza ochroną URL-i, która
używa wzorców e-maila, KSeF, księgi wieczystej i tokenów. Strażniki kontekstu wspólne dla kilku
przebiegów leżą w `src/guards/`, słowniki imion, miejscowości, pól formularzy, kont i nagłówków
kolumn w `src/dict/`, nazwiska i ich odmiana w `src/surnames.ts`, sumy kontrolne
w `src/validators.ts`. `src/index.ts` tylko reeksportuje publiczne API.

Pełna dokumentacja: <https://github.com/karolpolikarp/parawan>

Licencja: Apache 2.0, patrz [LICENSE](./LICENSE) i [NOTICE](./NOTICE). Wydania repozytorium do
v0.45.0 włącznie były publikowane na licencji MIT.
