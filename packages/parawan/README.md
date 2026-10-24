# parawan

Paczka o nazwie marki [Parawan](https://parawan.karolwilczynski.com): lokalny anonimizator
polskich danych osobowych (PESEL, NIP, REGON, IBAN, dowód, telefon, e-mail, adres, imię
i nazwisko i inne). Tekst nie opuszcza komputera.

Cały silnik jest w paczce [`anonimizator`](https://www.npmjs.com/package/anonimizator).
`parawan` instaluje ją jako zależność w tej samej wersji i udostępnia te same eksporty oraz
polecenie `parawan`. Obie paczki dają ten sam wynik, wybierz tę, której nazwa bardziej Ci pasuje.

```bash
npm install parawan
```

```ts
import { redactPII } from 'parawan';

const { redacted, found } = redactPII('Mój PESEL to 44051401359, mail jan@example.com');
// redacted: 'Mój PESEL to [PESEL], mail [EMAIL]'
```

Podścieżki są te same co w `anonimizator`: `parawan/ner`, `parawan/ner-postprocess`, `parawan/llm`.

CLI bez instalacji:

```bash
npx parawan pismo.txt                 # wynik na stdout, statystyki na stderr
npx parawan pismo.txt --out czysty.txt
npx parawan --help
```

Opis wszystkich funkcji, typów danych i opcji: README paczki
[`anonimizator`](https://github.com/karolpolikarp/parawan/tree/main/packages/core) i
[repozytorium projektu](https://github.com/karolpolikarp/parawan).

Licencja Apache 2.0.
