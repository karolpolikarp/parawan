/**
 * Przykład pod przyciskiem „Przykład” i w ?demo: krótki fragment fikcyjnego pisma urzędowego.
 * Wszystkie dane są zmyślone (numery mają poprawne sumy kontrolne, rachunek nie istnieje).
 * Pokazuje też, czego Parawan nie rusza: przepis („art. 104 Kpa”), numer działki i kwotę.
 * Miejscowość jest jednowyrazowa, bo dwuczłonową silnik zasłania dziś do połowy. Wynik
 * sprawdza content.test.ts, a numer PESEL i nazwisko powtarza scripts/e2e/helpers.mjs.
 */
export const EXAMPLE_TEXT = `Znak sprawy: RGK.6220.14.2026

Pan Tomasz Wierzbicki, ul. Lipowa 17, 62-650 Kłodawa, PESEL 85071412358

Na podstawie art. 104 Kpa zatwierdzam podział działki nr 245/7.
Nadpłata 17 zł zostanie zwrócona na rachunek PL43 1090 1014 0000 0712 4455 3921.
Kontakt: tel. 600 700 800, t.wierzbicki@example.com

Z up. Wójta
Joanna Malec
Kierownik Referatu Gospodarki Komunalnej`;
