# DESIGN.md: wygląd strony Parawana i znaczników

Kierunek „Sosna o poranku”: pocztówka znad morza w duchu polskiej szkoły plakatu turystycznego
(Orbis, PTTK). Jasna mgła i papier, zieleń sosny jako tusz, bursztynowe słońce, sosny na wydmie,
parawany na plaży. Humor siedzi w obrazie („Pozdrowienia znad danych”, znaczek „0 zł”), treść
zostaje rzeczowa. Wybrany 2026-11-26 wariant „u” z próbek `E:\parawan-landing-proby\r6-k2`.

Dotyczy strony `apps/landing` (z podstroną `/log/`). Z aplikacji `apps/web` wspólna jest paleta
kategorii danych na znacznikach.

## Zaakceptowane

- Kierunek „Sosna o poranku” i wariant „u”: nadmorska paleta kategorii ze znakiem kategorii na znaczniku.
- Krój Source Serif 4 w nagłówkach obok Archivo i IBM Plex Mono.
- Scena „Parawany stają tylko przy danych”: parawan rozkłada się nad daną, zwęża do szerokości
  znacznika, a znacznik wysuwa się na płótno. Mechaniki nie zmieniać, wolno ją dopracować.
- Wyróżnienia w długich tekstach: pogrubiona fraza w akapicie, ciepły zakreślacz pod jedną
  obietnicą sekcji, nazwa typu danych w barwie kategorii.
- Teksty bezosobowe (2026-11-26): bez form „my” i „wy”, bez zwracania się do czytelnika
  („Twój”, „sprawdzisz”, „decydujesz”). Tryb rozkazujący tylko na przyciskach i linkach („Pobierz”).

## Kolory

Tokeny w `apps/landing/src/style.css` (`:root`).

| Rola | Token | Wartość |
| --- | --- | --- |
| tusz (tekst, przyciski) | `--sosna` | `#0B3D2E` |
| tusz po najechaniu | `--sosna-2` | `#1C5A45` |
| papier (tło strony) | `--papier` | `#F1EEE6` |
| jasny papier (karty, okno) | `--papier-j` | `#FAF8F2` |
| mgła (pierwszy ekran, Skuteczność) | `--mgla-j` | `#DDE3DC` |
| piasek (scena) | `--piasek` | `#E7E1D2` |
| tekst drugorzędny | `--szary` | `#4A5A4F` |
| bursztyn | `--bursztyn` / `--bursztyn-t` / `--bursztyn-p` | `#B9791F` / `#7E5012` / `#EBCB93` |
| zakreślacz | `--marker` | `#F4DEAE` |

Kategorie danych (tekst / tło znacznika / pasek i znak / obwódka), te same w aplikacji
(`apps/web/src/style.css`) i na stronie:

| Kategoria | Tekst | Tło | Pasek | Obwódka |
| --- | --- | --- | --- | --- |
| Osoby (`person`) | `#6B2D62` | `#F3E5EF` | `#4F2148` | `#DECED9` |
| Kontakt (`contact`) | `#0B5C5E` | `#DDEEEC` | `#2F7F7C` | `#C5D8D6` |
| Identyfikatory (`ident`) | `#7A4A06` | `#F3ECDD` | `#B9791F` | `#DDD5C4` |
| Finanse (`fin`) | `#2E4E1B` | `#E6EDD9` | `#34531F` | `#CFD7C0` |
| Adres (`place`) | `#2C5689` | `#E1EAF5` | `#5F82B5` | `#C9D4E0` |

Kontrast tekstu znacznika na jego tle 6,2 do 7,9:1, pasek na tle znacznika co najmniej 3:1.
Jasność paska rośnie od osób do identyfikatorów, więc kategorie różnią się też jasnością,
nie tylko odcieniem.

## Typografia

- Source Serif 4 (400 do 600, kursywa 400): `h1`, `h2`, duże liczby, napisy na pocztówce. Pogrubienie
  w tym kroju najwyżej 600, bo plik ma zakres 400 do 600.
- Archivo (zmienny 100 do 900): tekst, `h3`, przyciski, pasek.
- IBM Plex Mono (400, 600): znaczniki, kod, pismo w scenie, okno z tekstem.
- Wszystkie fonty jako woff2 w `apps/landing/src/fonts/`, wtopione w plik jako `data:`.
  Nigdy zewnętrzny `<link>`.

## Odstępy i układ

- Szerokość treści `--w: 1240px`, margines boczny `--g: clamp(16px, 4vw, 48px)`.
- Sekcje oddziela rytm 100 do 110 px na komputerze i 64 do 72 px na telefonie, linie 1,5 px w tuszu
  i cienkie linie w kolorze piasku. Bez kart z cieniem na siatce, bez pigułek nad nagłówkami.
- Przejścia między sekcjami to ilustracje: brzeg morza, daleki bór we mgle, las w stopce.
- Na 320 px strona nie przewija się w poziomie.

## Znaczniki

- Znacznik to zakładka z kartoteki: tło i tekst w barwie kategorii, pasek z lewej, znak kategorii
  przed nazwą (osoba, dymek, krata numeru, karta, dom).
- Kolor nigdy nie jest jedynym sygnałem: znak na znaczniku, nazwa kategorii w legendzie
  i w tabeli typów.
- Fragment, który zostaje („na słońcu”): bursztynowa smuga pod tekstem, bez znaku kategorii.
  Bursztyn jako sygnał znaczy tylko to. Pasek kategorii Identyfikatory ma ten sam odcień,
  ale zawsze stoi na znaczniku ze znakiem, więc obu się nie myli.
- Wyciek w przykładach: kreskowanie z obwódką w tuszu, bez czerwieni.

## Ruch

- Scena zasłaniania na przewijaniu: trzy fazy na każdy fragment (płótno rośnie, miejsce zwęża się,
  znacznik wysuwa się). Oryginał gaśnie w całości, zanim płótno zacznie rosnąć: żadna klatka nie
  pokazuje części danej (sprawdza to `scripts/e2e/landing-scena.test.mjs`).
- Powyżej 960 px scena jest przypięta do ekranu, niżej zasłania się w rytmie przewijania.
- Pocztówka po wczytaniu raz: parawan rozkłada się panel po panelu od lewego kija, gość za nim chowa
  kapelusz, na znaczek spada stempel (ok. 1,9 s). Drzwi kabin nad tabelą typów i rzędy w
  „Skuteczności” domykają się przy wejściu w kadr, tak samo raz snop latarni przy „Jak sprawdzić”
  (obrót od morza) i stempel przy pobieraniu (uderza w papier). Liczniki sceny podjeżdżają o 5 px, słońce
  winiety wschodzi płynnie. Bez zapętlonych ozdobników poza dryfem mgły na pocztówce.
- `prefers-reduced-motion: reduce`: stan końcowy od razu i przycisk „Pokaż pismo przed zasłonięciem”.
- Bez JavaScriptu: stan końcowy policzony przy budowie tym samym `redactPII`.

## Ton tekstów

- Bezosobowo albo o Parawanie w trzeciej osobie. Bez „my”, „nas”, „nasz”, „wy”, „Twój”,
  „sprawdzisz”, „wybierasz”.
- Bez długich myślników, „100%”, „po prostu”, „w pełni”, mechanicznych trójek i marketingu.
- Liczby (typy danych, rozmiar pliku, skuteczność) brane z rdzenia i z `docs/BENCHMARK.md`,
  pilnowane testem `apps/web/src/landing.test.ts`.

## Czego nie robić

- Nie zmieniać mechaniki animacji zasłaniania.
- Nie pokazywać fragmentu danej w żadnej klatce ani w podpisie (podpis adresu pocztówki nie
  powtarza zasłoniętych danych).
- Nie używać bursztynu do kategorii ani do zakreślacza.
- Nie dodawać zewnętrznych fontów, obrazów ani skryptów: strona i plik nie wysyłają żadnych żądań.
- Nie dodawać obsługi zdarzeń w atrybutach HTML (`onsubmit=` itd.), bo CSP ze skrótem je blokuje.
- Nie wracać do szablonu „pigułka nad nagłówkiem, siatka kart z ikonami, pasek wielkich liczb”.
