// Identyfikatory techniczne: tokeny i sekrety, MAC, IPv6/IPv4, VIN.
import { maskKeepPrefix, type RedactCtx } from '../context.js';
import { precededByLegalRef } from '../validators.js';

// „eyJ" to base64 z „{\"": znikome FP, a token daje dostęp, więc maskujemy w całości.
// Źródło współdzielone z passProtectUrls, które zdejmuje JWT z adresów przed sentinelem.
export const JWT_SRC = String.raw`eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{2,}`;
const RE_JWT = new RegExp(String.raw`\b${JWT_SRC}`, 'g');

export function passTokens(ctx: RedactCtx): void {
  if (!ctx.on('TOKEN')) return;
  ctx.text = ctx.text.replace(RE_JWT, () => ctx.hit('TOKEN'));
  ctx.text = ctx.text.replace(
    /\b(?:sk_(?:live|test)_[A-Za-z0-9]{8,}|(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/g,
    () => ctx.hit('TOKEN'),
  );
}

// Etykieta przed łańcuchem par: mac/eui/duid (bez „HMAC", to skrót kryptograficzny), także
// z jednym wyrazem dopowiedzenia („EUI-64 interfejsu:", „DUID. . . :").
const RE_MAC_LABEL_BEFORE = /(?<![A-Za-z])(?:mac|eui(?:-?64)?|duid)(?:[ \t]+\p{L}+)?[\s:=.-]*$/iu;

// Musi biec przed IPv6, bo MAC pasuje do wzorca grup hex IPv6.
export function passMac(ctx: RedactCtx): void {
  if (!ctx.on('MAC')) return;
  // Cały łańcuch par z jednym separatorem, żeby nie ciąć dłuższego (numer seryjny, odcisk klucza,
  // „MAC=" z iptables) na sześciopary. Maska przy 6 parach, DHCP „01"+MAC (7), DUID-LLT (14),
  // DUID-LL (10), EUI-64 z „ff:fe" w środku (8) albo po etykiecie.
  ctx.text = ctx.text.replace(
    /\b[0-9A-Fa-f]{2}([:-])[0-9A-Fa-f]{2}(?:\1[0-9A-Fa-f]{2}){4,}\b/g,
    (m, _sep: string, offset: number) => {
      const pairs = (m.length + 1) / 3;
      if (pairs !== 6 && !(pairs === 7 && m.startsWith('01'))) {
        const hex = m.toLowerCase().replace(/[:-]/g, '');
        const embedsMac =
          (pairs === 14 && hex.startsWith('00010001')) ||
          (pairs === 10 && hex.startsWith('00030001')) ||
          (pairs === 8 && hex.slice(6, 10) === 'fffe');
        if (!embedsMac && !RE_MAC_LABEL_BEFORE.test(ctx.text.slice(Math.max(0, offset - 32), offset))) return m;
      }
      return ctx.hit('MAC');
    },
  );
  // Sześć par z mieszanymi separatorami („00:11-22:33-44:55"), tylko samodzielne, nie wycinek łańcucha.
  ctx.text = ctx.text.replace(
    /(?<![0-9A-Fa-f]{2}[:-])\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b(?![:-][0-9A-Fa-f]{2})/g,
    () => ctx.hit('MAC'),
  );
  // Notacja Cisco „aabb.ccdd.eeff" z co najmniej jedną literą hex. {0,13} ogranicza lookahead
  // do samego adresu, inaczej ciąg „1.1.1…" daje czas kwadratowy.
  ctx.text = ctx.text.replace(
    /\b(?=[0-9A-Fa-f.]{0,13}[A-Fa-f])(?:[0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4}(?![:\w-]|\.\w)/g,
    () => ctx.hit('MAC'),
  );
  // Po etykiecie „MAC" także notacja Cisco z samych cyfr.
  ctx.text = ctx.text.replace(
    /\b(MAC[\s:.=-]+)((?:[0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4})(?![:\w-]|\.\w)/gi,
    maskKeepPrefix(ctx, 'MAC'),
  );
}

const H = '[0-9A-Fa-f]{1,4}';
const IPV6 =
  `(?:${H}:){7}${H}|(?:${H}:){1,7}:|(?:${H}:){1,6}:${H}|(?:${H}:){1,5}(?::${H}){1,2}|` +
  `(?:${H}:){1,4}(?::${H}){1,3}|(?:${H}:){1,3}(?::${H}){1,4}|(?:${H}:){1,2}(?::${H}){1,5}|` +
  `${H}:(?:(?::${H}){1,6})|:(?:(?::${H}){1,7}|:)`;
// Kropka końca zdania po adresie jest dozwolona, kropka z kolejnym znakiem słownym nie.
const RE_IPV6 = new RegExp(`(?<![:.\\w])(?:${IPV6})(?![:\\w]|\\.\\w)`, 'g');
// Osiem par hex przez „:" to numer seryjny albo odcisk, nie IPv6 (passMac go zostawił).
const RE_HEX_8_PAIRS = /^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){7}$/;

// IPv6 przed IPv4. Jeden typ dla obu wersji.
export function passIp(ctx: RedactCtx): void {
  if (!ctx.on('IP')) return;
  ctx.text = ctx.text.replace(RE_IPV6, (m) => {
    if (RE_HEX_8_PAIRS.test(m)) return m;
    return ctx.hit('IP');
  });
  // Prawa granica jak w IPv6 („10.0.0.1.nip.io", OID „1.3.6.1.4" blokują). Kropka kończy też numer
  // punktu konspektu („1.2.3.4. Zakres prac"), więc adres przed kropką wymaga kontekstu sieciowego.
  ctx.text = ctx.text.replace(
    /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?!\d|\.\w)/g,
    (m, offset: number) => {
      if (precededByLegalRef(ctx.text, offset)) return m;
      if (RE_IPV4_VERSION_BEFORE.test(ctx.text.slice(Math.max(0, offset - 32), offset))) return m;
      if (isNonHostIpv4(m, ctx.text.slice(offset + m.length, offset + m.length + 4))) return m;
      if (ctx.text[offset + m.length] === '.' && !ipv4BeforeDotIsAddress(ctx.text, offset, m)) return m;
      return ctx.hit('IP');
    },
  );
}

/**
 * Adres bez hosta ani osoby: 0.0.0.0, pętla 127/8, maska podsieci, adres sieci w CIDR („10.0.0.0/24";
 * host „192.168.1.20/24" dalej maskujemy) i publiczne resolwery DNS. To parametry konfiguracji.
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
 * Numer wersji tuż przed liczbą, także z etykietą („Wersja klienta: 2.1.0.15") i jednym wyrazem
 * pośrednim, ale nie przyimkiem ani spójnikiem: „wdrożono wersję na 10.20.30.40" to host.
 * Lewa granica litery, bo „wersj" siedzi też w „konwersji" i „inwersji".
 */
const RE_IPV4_VERSION_BEFORE =
  /(?<![\p{L}\d])(?:wersj\p{L}*|ver|v|firmware|build|release|kernel|wydani\p{L}*)\.?(?:\s+(?!(?:na|z|ze|od|do|dla|po|pod|przy|przez|w|we|o|u|i|a|oraz|lub|albo|to|jest|za|nad)(?!\p{L}))\p{L}[\p{L}-]*)?\s*:?\s*$/iu;
const RE_IPV4_NET_CONTEXT =
  /(?<![\p{L}\d])(?:ip(?:v4)?|adres\p{L}*|host\p{L}*|serwer\p{L}*|bram\p{L}*|gateway|router\p{L}*|dns|połącz\p{L}*|logowa\p{L}*|zalogowa\p{L}*|nasłuch\p{L}*|interfejs\p{L}*|źródłow\p{L}*|docelow\p{L}*|klient\p{L}*|client|from|src|dst)(?![\p{L}\d])/iu;
const RE_IPV4_STRUCT_WORD =
  /(?<![\p{L}])(?:(?:rozdzia|podrozdzia|punk|sekcj|częś|tabel|rysun|załącznik|wersj|kwot|wynios|klasyfikac)\p{L}*|pkt|rozdz|tab|tabl|rys|zał|p|ver|v|zob|patrz|pkwiu|pkd|cpv|oid)[\s:.]*$/iu;
const RE_PHONE_WORD = /(?<![\p{L}])(?:tel|telefon\p{L}*|kontakt\p{L}*|stacjonarn\p{L}*|komórk\p{L}*|kom|fax|faks)(?![\p{L}])/iu;
// W linii o oprogramowaniu „serwer", „klient", „host" stoją obok numeru wersji
// („Kernel serwera 5.15.0.91."), więc sam kontekst sieciowy to za mało…
const RE_IPV4_SOFTWARE_CONTEXT =
  /(?<![\p{L}\d])(?:wersj\p{L}*|firmware|build|release|kernel|wydani\p{L}*|z?aktualiz\p{L}*|uaktualni\p{L}*|update\p{L}*|upgrade\p{L}*|patch\p{L}*|debian\p{L}*|ubuntu|centos|fedora|rhel|windows|android|macos|ios|freebsd)(?![\p{L}\d])/iu;
// …chyba że adres jest nazwany wprost słowem „IP" albo „adres".
const RE_IPV4_ADDRESS_WORD = /(?<![\p{L}\d])(?:ip(?:v4)?|adres\p{L}*)(?![\p{L}\d])/iu;
/**
 * Adres przed kropką tylko z kontekstem sieciowym w tej samej linii; 9 cyfr przy „tel." to telefon
 * dla passPhone. Linia w oknie 60 znaków, bo lastIndexOf w długiej linii bez „\n" jest kwadratowy.
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

// VIN: 17 znaków bez I/O/Q. Z etykietą zawsze; bez niej tylko układ wyraźnie VIN-owy
// (wielkie litery, ≥4 cyfry, ≥3 litery), inaczej to hash albo kod.
export function passVin(ctx: RedactCtx): void {
  if (!ctx.on('VIN')) return;
  // „nr vin" i „numer vin" łapie samo „vin" (prefiks zostaje w tekście bez zmian).
  ctx.text = ctx.text.replace(
    /\b((?:vin|n(?:ume)?r\s+nadwozia)[\s:.=-]*)([A-HJ-NPR-Za-hj-npr-z0-9]{17})\b/gi,
    maskKeepPrefix(ctx, 'VIN'),
  );
  ctx.text = ctx.text.replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, (m) => {
    const digits = (m.match(/\d/g) || []).length;
    const letters = (m.match(/[A-Z]/g) || []).length;
    if (digits >= 4 && letters >= 3) {
      return ctx.hit('VIN');
    }
    return m;
  });
}
