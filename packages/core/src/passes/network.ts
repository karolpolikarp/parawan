import { maskConst, type RedactCtx } from '../context.js';
import { precededByLegalRef } from '../validators.js';


// 1a) TOKEN (JWT + sekrety prefiksowe): eyJ<base64url>.… oraz sk_live_/ghp_/github_pat_/xox?-.
// „eyJ" = base64 z „{\"" — znikome FP, a token może dawać dostęp, więc maskujemy w całości.
export function passTokens(ctx: RedactCtx): void {
  if (!ctx.on('TOKEN')) return;
  ctx.text = ctx.text.replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{2,}/g, maskConst(ctx, 'TOKEN'));
  ctx.text = ctx.text.replace(
    /\b(?:sk_(?:live|test)_[A-Za-z0-9]{8,}|(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/g,
    maskConst(ctx, 'TOKEN'),
  );
}

// MAC: 6 par hex po „:"/„-". MUSI biec PRZED IPv6 (MAC pasuje do wzorca grup hex IPv6).
export function passMac(ctx: RedactCtx): void {
  if (!ctx.on('MAC')) return;
  // Bierzemy CAŁY łańcuch par hex z jednolitym separatorem i maskujemy go tylko przy dokładnie
  // 6 parach albo po etykiecie „MAC" (pole „MAC=" w logu iptables ma 14 par: dwa adresy i typ
  // ramki). Sztywne {5} cięło dłuższy łańcuch na sześciopary: numer seryjny „4a:3f:22:91:0c:7e:
  // 1d:55" dawał „[MAC]:1d:55", a odcisk klucza hosta „MD5:16:27:…" — „MD5:[MAC]:[MAC]:…".
  // Wyjątki: identyfikator klienta DHCP to typ sprzętu „01" (Ethernet) + MAC — 7 par; etykieta
  // „EUI-64" to sprzętowy adres urządzenia tak samo jak MAC (bez „HMAC" — to skrót kryptograficzny).
  // Identyfikatory z adresem karty w środku też w całości: DUID-LLT (00:01:00:01 + czas + MAC,
  // 14 par) i DUID-LL (00:03:00:01 + MAC, 10 par) z „ipconfig /all" oraz EUI-64 z „ff:fe" w środku
  // (MAC rozcięty wstawką) — bez tego łańcuch inny niż 6 par zostawiał cały adres sprzętowy jawny.
  // Etykieta może mieć jeden wyraz dopowiedzenia („EUI-64 interfejsu:", „DUID. . . :").
  ctx.text = ctx.text.replace(
    /\b[0-9A-Fa-f]{2}([:-])[0-9A-Fa-f]{2}(?:\1[0-9A-Fa-f]{2}){4,}\b/g,
    (m, _sep: string, offset: number) => {
      const pairs = (m.length + 1) / 3;
      const hex = m.toLowerCase().replace(/[:-]/g, '');
      const embedsMac =
        (pairs === 14 && hex.startsWith('00010001')) ||
        (pairs === 10 && hex.startsWith('00030001')) ||
        (pairs === 8 && hex.slice(6, 10) === 'fffe');
      const labeled = /(?<![A-Za-z])(?:mac|eui(?:-?64)?|duid)(?:[ \t]+\p{L}+)?[\s:=.-]*$/iu.test(ctx.text.slice(Math.max(0, offset - 32), offset));
      if (pairs !== 6 && !(pairs === 7 && m.startsWith('01')) && !embedsMac && !labeled) return m;
      ctx.bump('MAC');
      return ctx.M.MAC;
    },
  );
  // Sześć par z MIESZANYMI separatorami („00:11-22:33-44:55") jak dotąd — ale tylko samodzielne,
  // nie jako wycinek dłuższego łańcucha (ten zostawił już pierwszy przebieg).
  ctx.text = ctx.text.replace(
    /(?<![0-9A-Fa-f]{2}[:-])\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b(?![:-][0-9A-Fa-f]{2})/g,
    maskConst(ctx, 'MAC'),
  );
  // MAC w notacji Cisco: „aabb.ccdd.eeff" (3 grupy po 4 hex). Wymagamy ≥1 LITERY hex — w obrębie
  // samego adresu (14 znaków), stąd {0,13}: lookahead bez limitu skanował cały ciąg „1.1.1…"
  // od każdej pozycji (czas kwadratowy, sekundy na 100 tys. znaków).
  ctx.text = ctx.text.replace(
    /\b(?=[0-9A-Fa-f.]{0,13}[A-Fa-f])(?:[0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4}(?![:\w-]|\.\w)/g,
    maskConst(ctx, 'MAC'),
  );
  // Z SILNĄ etykietą „MAC" maskujemy notację Cisco także CZYSTO CYFROWĄ (etykieta wygrywa).
  ctx.text = ctx.text.replace(
    /\b((?:adres\w*\s+)?MAC[\s:.=-]+)((?:[0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4})(?![:\w-]|\.\w)/gi,
    (_m, pre: string) => {
      ctx.bump('MAC');
      return `${pre}${ctx.M.MAC}`;
    },
  );
}

// IP: IPv6 (grupy hex, także skrócone „::") PRZED IPv4 (oktety 0–255). Jeden typ dla obu wersji.
export function passIp(ctx: RedactCtx): void {
  if (!ctx.on('IP')) return;
  const H = '[0-9A-Fa-f]{1,4}';
  const IPV6 =
    `(?:${H}:){7}${H}|(?:${H}:){1,7}:|(?:${H}:){1,6}:${H}|(?:${H}:){1,5}(?::${H}){1,2}|` +
    `(?:${H}:){1,4}(?::${H}){1,3}|(?:${H}:){1,3}(?::${H}){1,4}|(?:${H}:){1,2}(?::${H}){1,5}|` +
    `${H}:(?:(?::${H}){1,6})|:(?:(?::${H}){1,7}|:)`;
  // Prawa granica: kropka KOŃCA ZDANIA po adresie jest OK, ale kropka z kolejnym znakiem słownym nie.
  // Osiem par hex przez „:" to numer seryjny albo odcisk, nie adres IPv6 (passMac go zostawił,
  // bo nie ma 6 par) — inaczej „Serial Number: 4a:3f:22:91:0c:7e:1d:55" dostawał [IP].
  ctx.text = ctx.text.replace(new RegExp(`(?<![:.\\w])(?:${IPV6})(?![:\\w]|\\.\\w)`, 'g'), (m) => {
    if (/^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){7}$/.test(m)) return m;
    ctx.bump('IP');
    return ctx.M.IP;
  });
  // IPv4: 4 oktety 0–255. Nie po „art./poz." ani po „wersja/ver./v" (numer wersji ≠ IP).
  // Prawa granica jak w IPv6: kropka z kolejnym znakiem słownym („10.0.0.1.nip.io", OID
  // „1.3.6.1.4") blokuje, sama kropka — nie. Ale kropka kończy też numer punktu konspektu
  // („1.2.3.4. Zakres prac", „w rozdziale 2.1.1.1."), więc adres przed kropką maskujemy tylko
  // z kontekstem sieciowym w tej samej linii (patrz ipv4BeforeDotIsAddress).
  ctx.text = ctx.text.replace(
    /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?!\d|\.\w)/g,
    (m, offset: number) => {
      if (precededByLegalRef(ctx.text, offset)) return m;
      if (RE_IPV4_VERSION_BEFORE.test(ctx.text.slice(Math.max(0, offset - 32), offset))) return m;
      if (isNonHostIpv4(m, ctx.text.slice(offset + m.length, offset + m.length + 4))) return m;
      if (ctx.text[offset + m.length] === '.' && !ipv4BeforeDotIsAddress(ctx.text, offset, m)) return m;
      ctx.bump('IP');
      return ctx.M.IP;
    },
  );
}

/**
 * Adres, który nie wskazuje żadnego hosta ani osoby: nieokreślony 0.0.0.0, pętla zwrotna 127/8,
 * maska podsieci (ciągła, od 255), adres SIECI w notacji CIDR („10.0.0.0/24" — host z prefiksem
 * „192.168.1.20/24" dalej jest maskowany) i publiczne resolwery DNS. To parametry konfiguracji,
 * a ich maskowanie tylko zaciemnia instrukcje i logi.
 */
const PUBLIC_DNS_IPV4 = new Set(['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1', '9.9.9.9', '149.112.112.112']);
function isNonHostIpv4(ip: string, after: string): boolean {
  const o = ip.split('.').map(Number);
  if (ip === '0.0.0.0' || o[0] === 127 || PUBLIC_DNS_IPV4.has(ip)) return true;
  if (o[0] === 255) {
    const inv = ~(((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0) >>> 0;
    if ((inv & (inv + 1)) === 0) return true;
  }
  return o[3] === 0 && /^\/\d{1,2}(?!\d)/.test(after);
}
/**
 * Numer wersji, nie adres: słowo „wersja/ver/v", „firmware", „build", „release", „kernel",
 * „wydanie" tuż przed liczbą. Okno 32 znaków, polskie końcówki („wersję", „wersji"), dwukropek
 * etykiety („Wersja klienta: 2.1.0.15") i jeden wyraz pośredni („wersję systemu 2.0.1.3") —
 * ale nie przyimek ani spójnik: „wdrożono wersję na 10.20.30.40" to host, na który wdrożono.
 * Lewa granica litery, bo „wersj" siedzi też w „konwersji" i „inwersji" („konwersja adresów
 * 192.168.1.15" to adres).
 */
const RE_IPV4_VERSION_BEFORE =
  /(?<![\p{L}\d])(?:wersj\p{L}*|ver|v|firmware|build|release|kernel|wydani\p{L}*)\.?(?:\s+(?!(?:na|z|ze|od|do|dla|po|pod|przy|przez|w|we|o|u|i|a|oraz|lub|albo|to|jest|za|nad)(?!\p{L}))\p{L}[\p{L}-]*)?\s*:?\s*$/iu;
const RE_IPV4_NET_CONTEXT =
  /(?<![\p{L}\d])(?:ip(?:v4)?|adres\p{L}*|host\p{L}*|serwer\p{L}*|bram\p{L}*|gateway|router\p{L}*|dns|połącz\p{L}*|logowa\p{L}*|zalogowa\p{L}*|nasłuch\p{L}*|interfejs\p{L}*|źródłow\p{L}*|docelow\p{L}*|klient\p{L}*|client|from|src|dst)(?![\p{L}\d])/iu;
const RE_IPV4_STRUCT_WORD =
  /(?<![\p{L}])(?:(?:rozdzia|podrozdzia|punk|sekcj|częś|tabel|rysun|załącznik|wersj|kwot|wynios|klasyfikac)\p{L}*|pkt|rozdz|tab|tabl|rys|zał|p|ver|v|zob|patrz|pkwiu|pkd|cpv|oid)[\s:.]*$/iu;
const RE_PHONE_WORD = /(?<![\p{L}])(?:tel|telefon\p{L}*|kontakt\p{L}*|stacjonarn\p{L}*|komórk\p{L}*|kom|fax|faks)(?![\p{L}])/iu;
// Linia o oprogramowaniu: wydanie, aktualizacja, jądro, nazwa systemu. Słowa „serwer", „klient",
// „host" stoją tu obok numeru wersji („Aktualizacja serwera do 7.0.3.12.", „Kernel serwera
// 5.15.0.91.", „Serwer działa na Debianie 12.0.1.2.") — sam kontekst sieciowy to za mało.
const RE_IPV4_SOFTWARE_CONTEXT =
  /(?<![\p{L}\d])(?:wersj\p{L}*|firmware|build|release|kernel|wydani\p{L}*|z?aktualiz\p{L}*|uaktualni\p{L}*|update\p{L}*|upgrade\p{L}*|patch\p{L}*|debian\p{L}*|ubuntu|centos|fedora|rhel|windows|android|macos|ios|freebsd)(?![\p{L}\d])/iu;
// …chyba że w linii adres jest nazwany wprost: „IP" albo „adres" („po aktualizacji logowanie
// z adresu …", „Adres IP serwera po aktualizacji: …").
const RE_IPV4_ADDRESS_WORD = /(?<![\p{L}\d])(?:ip(?:v4)?|adres\p{L}*)(?![\p{L}\d])/iu;
/**
 * Czy kandydat na IPv4 stojący PRZED KROPKĄ to adres, a nie numer punktu? Bez tej bramki
 * prosta zmiana granicy maskowała numerację konspektu, odwołania („w punkcie 5.3.2.1.")
 * i kwoty z kropkami — regresja, której benchmark nie widzi. Wymagamy kontekstu sieciowego
 * w tej samej linii; numer sam w linii to nagłówek; 9 cyfr przy słowie „tel." to telefon
 * zapisany z kropkami (przejmie go passPhone); w linii o wersji oprogramowania — tylko adres
 * nazwany wprost. Linię wyznaczamy w oknie 60 znaków, nie przez lastIndexOf po całym tekście:
 * w długiej linii bez „\n" (ekstrakcja PDF, zminifikowany log) to był koszt kwadratowy.
 */
function ipv4BeforeDotIsAddress(full: string, offset: number, m: string): boolean {
  const win = full.slice(Math.max(0, offset - 60), offset);
  const lead = win.slice(win.lastIndexOf('\n') + 1);
  if (!/\S/.test(lead)) return false;
  if (RE_IPV4_STRUCT_WORD.test(lead.slice(-24))) return false;
  if (m.replace(/\D/g, '').length === 9 && RE_PHONE_WORD.test(lead)) return false;
  if (RE_IPV4_SOFTWARE_CONTEXT.test(lead) && !RE_IPV4_ADDRESS_WORD.test(lead)) return false;
  return RE_IPV4_NET_CONTEXT.test(lead);
}

// VIN: 17 znaków, charset bez I/O/Q. Z kontekstem („VIN"/„nadwozia") ZAWSZE; bez kontekstu tylko
// gdy układ jest wyraźnie VIN-owy (WIELKIE litery + ≥4 cyfry + ≥3 litery) — inaczej hash/kod.
export function passVin(ctx: RedactCtx): void {
  if (!ctx.on('VIN')) return;
  ctx.text = ctx.text.replace(
    /\b((?:vin|nr\s+vin|numer\s+vin|nr\s+nadwozia|numer\s+nadwozia)[\s:.=-]*)([A-HJ-NPR-Za-hj-npr-z0-9]{17})\b/gi,
    (_m, pre: string) => {
      ctx.bump('VIN');
      return `${pre}${ctx.M.VIN}`;
    },
  );
  ctx.text = ctx.text.replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, (m) => {
    const digits = (m.match(/\d/g) || []).length;
    const letters = (m.match(/[A-Z]/g) || []).length;
    if (digits >= 4 && letters >= 3) {
      ctx.bump('VIN');
      return ctx.M.VIN;
    }
    return m;
  });
}
