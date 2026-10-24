/**
 * Podstrona /log/: dziennik zmian (CHANGELOG.md) i plan (ROADMAP.md) jako jeden plik HTML bez
 * skryptu. Składa ją wtyczka parawan-log w vite.config.ts po zbudowaniu strony głównej: style
 * i fonty bierze z gotowego dist/index.html (te same, wbudowane jako data:), dokłada log.css
 * i politykę CSP ze script-src 'none'.
 *
 * Zakładki „Zmiany” i „Plan” działają bez JavaScriptu: sekcja #plan stoi w pliku przed #zmiany
 * i pokazuje się tylko jako cel adresu (:target), a wtedy ukrywa sąsiednią #zmiany. Bez CSS,
 * na wydruku i w czytniku widać obie.
 */
import { dataPoPolsku, escapeHtml, mdNaHtml, planZRoadmapy, porownajWersje, twardeSpacje, type Wersja, wersjeZChangelogu } from './changelog-html';
import { parawanMark } from './icons';

/** Wersje starsze niż ta są na stronie zwinięte w <details>. */
export const ZWIJAJ_PRZED = '0.46.0';

export const LOG_URL = 'https://parawan.karolwilczynski.com/log/';
const REPO = 'https://github.com/karolpolikarp/parawan';

export interface DaneLogu {
  changelog: string;
  /** Treść ROADMAP.md albo null, gdy pliku nie ma. */
  roadmap: string | null;
  /** Treść tagów <style> strony głównej (fonty i wspólne style). */
  style: string;
  /** Style samej podstrony (log.css). */
  styleLogu: string;
  /** Polityka CSP do <meta>. */
  csp: string;
  /** Tag <link rel="icon"> strony głównej (ikona jako data:). */
  ikona: string;
}

const zew = 'target="_blank" rel="noopener noreferrer"';

function zakladki(biezaca: 'zmiany' | 'plan'): string {
  const a = (id: 'zmiany' | 'plan', tekst: string) =>
    `<a href="#${id}"${id === biezaca ? ' aria-current="true"' : ''}>${tekst}</a>`;
  return `<nav class="zakladki" aria-label="Zakładki ${biezaca === 'zmiany' ? 'w zmianach' : 'w planie'}"><div class="wrap zakladki-in">${a('zmiany', 'Zmiany')}${a('plan', 'Plan')}</div></nav>`;
}

function czas(w: Wersja): string {
  return w.data ? `<time datetime="${w.data}">${dataPoPolsku(w.data)}</time>` : '';
}

function wpis(w: Wersja): string {
  const tresc = mdNaHtml(w.md) || '<p>Bez opisu.</p>';
  const dopisek =
    w.wersja === null && w.id === 'w-przygotowaniu'
      ? '<p class="wersja-data">Zmiany w repozytorium, których nie ma jeszcze w pobieranym pliku.</p>'
      : w.data
        ? `<p class="wersja-data">${czas(w)}</p>`
        : '';
  return (
    `<article class="wersja" id="${w.id}" aria-labelledby="${w.id}-h">` +
    `<h3 id="${w.id}-h"><a class="kotw" href="#${w.id}">${escapeHtml(w.tytul)}</a></h3>${dopisek}` +
    `<div class="md">${tresc}</div></article>`
  );
}

/**
 * Zwinięta starsza wersja. Kotwica stoi na treści wewnątrz <details>, a nie na nim samym:
 * przeglądarka rozwija zamknięte <details>, gdy adres prowadzi do elementu w środku, więc link
 * /log/#v0-17-0 od razu pokazuje opis wersji.
 */
function wpisZwiniety(w: Wersja): string {
  return (
    `<details class="wersja wersja-stara">` +
    `<summary><h4>${escapeHtml(w.tytul)}</h4>${w.data ? ` <span class="wersja-data">${czas(w)}</span>` : ''}</summary>` +
    `<div class="md" id="${w.id}">${mdNaHtml(w.md) || '<p>Bez opisu.</p>'}</div></details>`
  );
}

export function stronaLogu(d: DaneLogu): string {
  const wersje = wersjeZChangelogu(d.changelog);
  const nowe = wersje.filter((w) => !w.wersja || porownajWersje(w.wersja, ZWIJAJ_PRZED) >= 0);
  const stare = wersje.filter((w) => w.wersja && porownajWersje(w.wersja, ZWIJAJ_PRZED) < 0);
  const najnowsza = wersje.find((w) => w.wersja);

  const spisZmian =
    nowe.map((w) => `<li><a href="#${w.id}">${escapeHtml(w.tytul)}</a></li>`).join('') +
    (stare.length ? `<li><a href="#starsze">Starsze (${stare.length})</a></li>` : '');

  const starsze = stare.length
    ? `<section class="starsze" aria-labelledby="starsze"><h3 id="starsze">Starsze wersje, od ${escapeHtml(stare[0].tytul)} do ${escapeHtml(stare[stare.length - 1].tytul)}</h3>` +
      `<p class="starsze-opis">Każda wersja jest zwinięta. Kliknij numer, żeby rozwinąć opis.</p>${stare.map(wpisZwiniety).join('')}</section>`
    : '';

  const plan = d.roadmap ? planZRoadmapy(d.roadmap) : null;
  const planTresc = plan
    ? `${plan.wstep ? `<div class="md plan-wstep">${plan.wstep}</div>` : ''}<div class="md plan">${plan.tresc}</div>`
    : `<p class="pusto">Plan nie jest jeszcze opublikowany. Zajrzyj do <a href="${REPO}" ${zew}>repozytorium</a>.</p>`;

  const body = twardeSpacje(`    <a href="#tresc" class="vh">Przejdź do treści</a>
    <nav class="pasek" aria-label="Główna">
      <div class="pasek-in">
        <a href="../" class="marka" aria-label="Parawan, strona główna"><span class="znak"><i class="gi">${parawanMark()}</i></span><b>Parawan</b></a>
        <div class="pasek-linki">
          <a href="../#typy">Typy danych</a>
          <a href="../#sprawdz">Jak sprawdzić</a>
          <a href="../#dla-iod">Dla IOD i IT</a>
          <a href="./" aria-current="page">Zmiany</a>
          <a href="${REPO}" ${zew}>GitHub ↗</a>
        </div>
        <a class="btn btn-cta btn-sm pasek-pobierz" href="../pobierz/Parawan.html" download>Pobierz</a>
      </div>
    </nav>

    <main id="tresc">
      <header class="log-glowa">
        <div class="wrap">
          <h1>Zmiany i plan</h1>
          <p class="lede">Co zmieniało się w kolejnych wersjach pliku Parawan.html i co jest zaplanowane dalej.${najnowsza ? ` Najnowsza wydana wersja to <a href="#${najnowsza.id}">${escapeHtml(najnowsza.tytul)}</a>${najnowsza.data ? ` z ${dataPoPolsku(najnowsza.data)}` : ''}.` : ''} Strona powstaje z plików <a href="${REPO}/blob/main/CHANGELOG.md" ${zew}>CHANGELOG.md</a> i <a href="${REPO}/blob/main/ROADMAP.md" ${zew}>ROADMAP.md</a> przy każdym wydaniu, a także przy zmianach planu albo samej strony.</p>
        </div>
      </header>

      <section class="zakladka" id="plan" aria-labelledby="plan-h">
        ${zakladki('plan')}
        <div class="wrap dok-siatka">
          <div class="dok-bok">
            <h2 id="plan-h">Plan</h2>
            <p>Co jest w kolejce, w trzech horyzontach. Plan to zamiar, a nie obietnica terminu.</p>
          </div>
          <div class="dok-tresc">${planTresc}</div>
        </div>
      </section>

      <section class="zakladka" id="zmiany" aria-labelledby="zmiany-h">
        ${zakladki('zmiany')}
        <div class="wrap dok-siatka">
          <div class="dok-bok">
            <h2 id="zmiany-h">Zmiany</h2>
            <p>Od najnowszej wersji. Wersje starsze niż v${ZWIJAJ_PRZED} są niżej, zwinięte.</p>
            <nav class="spis" aria-label="Spis wersji"><ul>${spisZmian}</ul></nav>
          </div>
          <div class="dok-tresc">${nowe.map(wpis).join('')}${starsze}</div>
        </div>
      </section>
    </main>

    <footer class="stopka">
      <div class="wrap">
        <div class="stopka-in">
          <p class="stopka-marka"><span class="znak"><i class="gi">${parawanMark()}</i></span><span><b>Parawan</b>. Dane za parawanem. Autor: <a href="https://karolwilczynski.com" ${zew}>Karol Wilczyński</a>.</span></p>
          <ul class="stopka-linki">
            <li><a href="../">Strona główna</a></li>
            <li><a href="${REPO}" ${zew}>Kod na GitHubie</a></li>
            <li><a href="${REPO}/releases" ${zew}>Lista wydań</a></li>
            <li><a href="${REPO}/issues" ${zew}>Zgłoś nietrafione wykrycie</a></li>
          </ul>
        </div>
        <p class="stopka-prawo">Kod: Apache 2.0. Fonty Archivo oraz IBM Plex Mono: SIL OFL 1.1.</p>
      </div>
    </footer>
`);
  return `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${d.csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light" />
    <meta name="theme-color" content="#f7f5ef" />
    ${d.ikona}
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <title>Zmiany i plan: Parawan</title>
    <meta name="description" content="Co zmieniało się w kolejnych wersjach Parawana, anonimizatora polskich danych osobowych w jednym pliku HTML, i co jest zaplanowane w następnych wydaniach." />
    <link rel="canonical" href="${LOG_URL}" />
    <meta property="og:title" content="Zmiany i plan: Parawan" />
    <meta property="og:description" content="Dziennik zmian od v0.1.0 i plan następnych wydań Parawana." />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${LOG_URL}" />
    <meta property="og:locale" content="pl_PL" />
    <meta property="og:site_name" content="Parawan" />
    <meta property="og:image" content="https://parawan.karolwilczynski.com/og.png" />
    <style>${d.style}</style>
    <style>${d.styleLogu}</style>
  </head>
  <body class="log">${body}  </body>
</html>
`;
}
