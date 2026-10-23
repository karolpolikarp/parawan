# Zgłaszanie błędów bezpieczeństwa

Parawan.html działa bez sieci, więc błąd bezpieczeństwa to przede wszystkim:

- sposób, w jaki tekst albo wynik może opuścić kartę przeglądarki (obejście
  Content-Security-Policy, nawigacja, wydruk, pobierany plik);
- treść wczytanego pliku, która uruchamia kod w aplikacji;
- ujawnienie danych w miejscu, które użytkownik uważa za zasłonięte (wydruk,
  pobrany plik .txt albo .docx, jego właściwości).

## Jak zgłosić

Poufne zgłaszanie podatności przez GitHub jest w tym repozytorium wyłączone. Do
czasu jego włączenia załóż zgłoszenie w
[Issues](https://github.com/karolpolikarp/parawan/issues/new) z tytułem
„Prośba o kontakt w sprawie bezpieczeństwa”. Nie opisuj w nim błędu i nie
dołączaj żadnych danych. Autor odpowie w zgłoszeniu i poda sposób przekazania
szczegółów poza publicznym wątkiem. Do opisu błędu wystarczy zmyślony
przykład, bez prawdziwych danych osobowych.

Nazwisko albo numer, którego Parawan nie zasłonił, to zwykły błąd wykrywania.
Zgłoś go publicznie w Issues, także na zmyślonym przykładzie.

## Czego się spodziewać

Projekt prowadzi jedna osoba prywatna, bez gwarantowanego terminu odpowiedzi.
Poprawka bezpieczeństwa wychodzi jako nowe wydanie, a jego opis podaje
pilność aktualizacji: zwykła, zalecana albo pilna. Pilna znaczy, że po poprawce
Parawan zasłania coś, co wcześniej przepuszczał.

## Sprawdzenie pliku

Wydania są budowane w GitHub Actions z tagu. Sumy SHA-256 są w pliku
SHA256SUMS.txt i w opisie wydania, a pochodzenie pliku sprawdzisz poleceniem:

```
gh attestation verify Parawan.html --repo karolpolikarp/parawan
```
