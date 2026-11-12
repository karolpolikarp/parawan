import { normalizeSurnameKey } from './surnames.js';
import { indexToLetters, type RedactCtx } from './context.js';
import { passAddress, passAddressAfterResidenceLabel, passPostalNoHyphen } from './passes/address.js';
import { passBirthDate } from './passes/birth-date.js';
import { passCity } from './passes/city.js';
import { passDriverLicense, passIdCard, passKrs, passPassport, passPlate, passPostal } from './passes/documents.js';
import { passEmail } from './passes/email.js';
import { finalizePersons, passJsonRequote, passRestoreJsonEscapes } from './passes/finalize.js';
import { passFormFields } from './passes/forms.js';
import { passKsef, passKw, passZnakSprawy } from './passes/kw-ksef-case.js';
import { passLogin } from './passes/login.js';
import { passIp, passMac, passTokens, passVin } from './passes/network.js';
import { passAccount, passCard, passIban, passNip, passPesel, passPhone, passRegon } from './passes/numeric.js';
import { passPersonMaidenAfterMask, passPersonMixedCase, passPersonOcrMix, passPersonOcrPair, passPersonOcrTitle, passPersonParents } from './passes/person-caps-ocr.js';
import { passPersonPairs, passProtectFictional } from './passes/person-pairs.js';
import { passPersonForeign, passPersonHomographAnchor, passPersonInitial, passPersonRoleComplement, passPersonSoloDict, passPersonSoloMorph, passPersonStrongTrigger, passPersonTrigger } from './passes/person-triggers.js';
import { passProtectJsonEscapes, passProtectUrls } from './passes/protect.js';
import { passDelimitedTable, passStructured } from './passes/structured.js';
import { HUMAN_LABEL, MASK, type PiiFinding, type PiiType, type RedactionResult, type RedactOptions } from './types.js';


// ============================================================================
// Główna funkcja redakcji
// ============================================================================

export function redactPII(input: string, options?: RedactOptions): RedactionResult {
  if (!input || typeof input !== 'string') {
    return { redacted: input ?? '', found: [] };
  }

  const counts = new Map<PiiType, number>();
  const bump = (t: PiiType) => counts.set(t, (counts.get(t) ?? 0) + 1);

  // Filtr typów (brak = wszystkie) i ewentualne własne placeholdery.
  const enabled = options?.types ? new Set(options.types) : null;
  const on = (t: PiiType) => enabled === null || enabled.has(t);
  const M: Record<PiiType, string> = options?.masks ? { ...MASK, ...options.masks } : MASK;

  // Pseudonimizacja: klucz (znormalizowane nazwisko) → stała etykieta [OSOBA-X].
  // Etykiety przydzielane w kolejności WYKRYCIA (pary → wyzwalacze → solo), deterministycznie.
  const personLabels = options?.pseudonyms ? new Map<string, string>() : null;
  const maskedSurnames = new Set<string>();
  const personMask = (surnameToken: string): string => {
    const key = normalizeSurnameKey(surnameToken);
    maskedSurnames.add(key);
    if (!personLabels) return M.IMIE;
    let label = personLabels.get(key);
    if (!label) {
      label = indexToLetters(personLabels.size);
      personLabels.set(key, label);
    }
    return `[OSOBA-${label}]`;
  };

  const ctx: RedactCtx = { text: input, raw: input, on, bump, M, personMask, pseudonyms: !!personLabels, maskedSurnames, protectedUrls: [], jsonEscapes: false, loginSeeds: new Set() };

  // Kolejność MA znaczenie: przebiegi czytają placeholdery poprzednich, a kolejność pierwszego
  // bump danego typu wyznacza kolejność listy `found`. Sekwencja = dawna kolejność fizyczna 1:1.

  // ═══════════════════════ FAZA 0 · OCHRONA URL (sentinel) ═══════════════════════
  passProtectJsonEscapes(ctx); // PRZED URL-ami: podmieniona ucieczka kończy adres
  passProtectUrls(ctx);

  // ═════════ FAZA 1 · STRUKTURALNE WYSOKIEJ PRECYZJI (etykieta / wzorzec) ═════════
  passEmail(ctx);
  passTokens(ctx);
  passMac(ctx);
  passIp(ctx);
  passVin(ctx);
  passFormFields(ctx);
  passStructured(ctx);
  passDelimitedTable(ctx);
  passLogin(ctx);
  // PRZED passZnakSprawy (kształt numeru KSeF pasuje do wzorca znaku sprawy — dostawał wtedy
  // maskę [ZNAK-SPRAWY]) i PRZED passNip (inaczej znika sam NIP, reszta numeru zostaje jawna).
  passKsef(ctx);
  passKw(ctx); // PRZED passZnakSprawy: numer KW po „Sygn."/„Znak:" dostawał maskę znaku sprawy
  passZnakSprawy(ctx);

  // ═════ FAZA 2 · IDENTYFIKATORY NUMERYCZNE (suma kontrolna / etykieta / długość) ═════
  passIban(ctx);
  passAccount(ctx);
  passPesel(ctx);
  passNip(ctx);
  passCard(ctx);
  passRegon(ctx);
  passPhone(ctx);
  passIdCard(ctx);
  passPassport(ctx);
  passKrs(ctx);
  passDriverLicense(ctx);
  passPlate(ctx);
  passPostal(ctx);

  // ═══════════════════ FAZA 3 · DATA I ADRES / MIEJSCOWOŚĆ ═══════════════════
  passBirthDate(ctx);
  passAddress(ctx);
  passAddressAfterResidenceLabel(ctx);
  passPostalNoHyphen(ctx);
  passCity(ctx);

  // ═══════════════════ FAZA 4 · IMIĘ I NAZWISKO (heurystyka) ═══════════════════
  passProtectFictional(ctx);
  passPersonMixedCase(ctx); // PRZED wyzwalaczem „Pan/Pani" (zjadał imię, nazwisko zostawało jawne)
  passPersonRoleComplement(ctx);
  passPersonPairs(ctx);
  passPersonTrigger(ctx);
  passPersonStrongTrigger(ctx);
  passPersonSoloDict(ctx);
  passPersonInitial(ctx);
  passPersonHomographAnchor(ctx);
  passPersonForeign(ctx);
  passPersonSoloMorph(ctx);
  passPersonOcrTitle(ctx);
  passPersonOcrPair(ctx);
  passPersonOcrMix(ctx);
  passPersonMaidenAfterMask(ctx);
  passPersonParents(ctx);

  // ══════ FAZA 5 · DOMKNIĘCIA OSÓB · STABILNA NUMERACJA · PRZYWRÓCENIE URL ══════
  finalizePersons(ctx);
  passRestoreJsonEscapes(ctx);
  passJsonRequote(ctx); // na samym końcu: widzi tekst z przywróconymi ucieczkami

  const found: PiiFinding[] = [...counts.entries()].map(([type, count]) => ({ type, count }));
  return { redacted: ctx.text, found };
}

/** Wygodny skrót: czy tekst zawiera jakiekolwiek PII (np. do ostrzeżeń UI). */
export function hasPII(text: string): boolean {
  return redactPII(text).found.length > 0;
}

export function describeFindings(found: PiiFinding[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const f of found) {
    const label = HUMAN_LABEL[f.type];
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}
