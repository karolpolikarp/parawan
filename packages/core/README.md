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
**walidowana**, więc przypadkowe ciągi cyfr (sygnatury, numery przepisów) nie są maskowane.
Redakcja jest idempotentna.

Pakietu nie ma jeszcze w rejestrze npm. Do czasu publikacji instalujesz go z repozytorium
(szczegóły w [README projektu](https://github.com/karolpolikarp/parawan), sekcja „Dla programistów”):

```bash
git clone https://github.com/karolpolikarp/parawan.git
cd parawan
npm ci
npm run build -w anonimizator          # rdzeń → packages/core/dist
# we własnym projekcie (ścieżka względem niego):
npm install ../parawan/packages/core
```

```ts
import { redactPII } from 'anonimizator';

const { redacted, found } = redactPII('Mój PESEL to 44051401359, mail jan@example.com');
// redacted → 'Mój PESEL to [PESEL], mail [EMAIL]'
// found    → [{ type: 'EMAIL', count: 1 }, { type: 'PESEL', count: 1 }]
//            (kolejność elementów found nie jest częścią kontraktu)
```

CLI (z katalogu repozytorium, po zbudowaniu rdzenia):

```bash
node packages/core/bin/anonimizator.js dokument.txt --out czysty.txt
```

**Ograniczenie:** wykrywanie imion i nazwisk warstwą podstawową jest heurystyczne (słownik
imion i nazwisk, morfologia, wyzwalacze kontekstu), więc zawsze przejrzyj wynik przed
udostępnieniem. Recall rzadkich nazwisk podnosi opcjonalna lokalna usługa NER z dodatku
[anonimizator-ai](https://github.com/karolpolikarp/anonimizator-ai). Jest fail-safe: jej awaria
nigdy nie obniża ochrony poniżej warstwy regex.

```ts
import { redactPIIFull } from 'anonimizator/ner';

const { redacted } = await redactPIIFull(tekst, { url: 'http://127.0.0.1:8090' });
```

Pełna dokumentacja: <https://github.com/karolpolikarp/parawan>

Licencja: Apache 2.0, patrz [LICENSE](./LICENSE) i [NOTICE](./NOTICE). Wydania repozytorium do
v0.45.0 włącznie były publikowane na licencji MIT.
