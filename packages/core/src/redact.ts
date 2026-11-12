// Orkiestrator redakcji: przygotowuje kontekst i woła przebiegi w ustalonej kolejności.
import { normalizeSurnameKey } from './surnames.js';
import { indexToLetters, type RedactCtx } from './context.js';
import { passAddress, passAddressAfterResidenceLabel, passPostalNoHyphen } from './passes/address.js';
import { passBirthDate } from './passes/birth-date.js';
import { passCity } from './passes/city.js';
import { passDriverLicense, passIdCard, passKrs, passPassport, passPlate, passPostal } from './passes/documents.js';
import { passEmail } from './passes/email.js';
import { finalizePersons, passJsonRequote, passRestoreJsonEscapes } from './passes/finalize.js';
import { passFormFields } from './passes/forms.js';
import { hasKsefAnchor, passKsef, passKw, passZnakSprawy } from './passes/kw-ksef-case.js';
import { passLogin } from './passes/login.js';
import { passIp, passMac, passTokens, passVin } from './passes/network.js';
import { passAccount, passCard, passIban, passNip, passPesel, passPhone, passRegon } from './passes/numeric.js';
import { passPersonMaidenAfterMask, passPersonMixedCase, passPersonOcrMix, passPersonOcrPair, passPersonOcrTitle, passPersonParents } from './passes/person-caps-ocr.js';
import { passPersonPairs, passProtectFictional } from './passes/person-pairs.js';
import { passPersonForeign, passPersonHomographAnchor, passPersonInitial, passPersonRoleComplement, passPersonSoloDict, passPersonSoloMorph, passPersonStrongTrigger, passPersonTrigger } from './passes/person-triggers.js';
import { passProtectJsonEscapes, passProtectUrls } from './passes/protect.js';
import { passDelimitedTable, passStructured } from './passes/structured.js';
import { HUMAN_LABEL, MASK, type PiiFinding, type PiiType, type RedactionResult, type RedactOptions } from './types.js';

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
  const hit = (t: PiiType): string => {
    bump(t);
    return M[t];
  };

  // Klucz nazwiska → etykieta tymczasowa; ostateczną numerację nadaje finalizePersons.
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

  const ctx: RedactCtx = { text: input, raw: input, ksefAnchor: hasKsefAnchor(input), on, bump, hit, M, personMask, pseudonyms: !!personLabels, maskedSurnames, protectedUrls: [], jsonEscapes: false, loginSeeds: new Set() };

  // Kolejność ma znaczenie: przebiegi czytają placeholdery poprzednich, a pierwszy bump typu
  // ustala kolejność `found`.

  // Faza 0: ochrona URL-i (sentinel)
  passProtectJsonEscapes(ctx); // przed URL-ami: podmieniona ucieczka kończy adres
  passProtectUrls(ctx);

  // Faza 1: dane strukturalne o wysokiej precyzji (etykieta, wzorzec)
  passEmail(ctx);
  passTokens(ctx);
  passMac(ctx);
  passIp(ctx);
  passVin(ctx);
  passFormFields(ctx);
  passStructured(ctx);
  passDelimitedTable(ctx);
  passLogin(ctx);
  // KSeF przed znakiem sprawy i NIP: numer KSeF zawiera NIP i pasuje do wzorca znaku sprawy.
  passKsef(ctx);
  passKw(ctx); // przed znakiem sprawy: numer KW stoi po „Sygn.” albo „Znak:”
  passZnakSprawy(ctx);

  // Faza 2: identyfikatory numeryczne (suma kontrolna, etykieta, długość)
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

  // Faza 3: data urodzenia, adres, miejscowość
  passBirthDate(ctx);
  passAddress(ctx);
  passAddressAfterResidenceLabel(ctx);
  // Kod bez myślnika i miejscowość kotwiczą na już zamaskowanym [ADRES] i [KOD-POCZTOWY],
  // dlatego biegną po adresie.
  passPostalNoHyphen(ctx);
  passCity(ctx);

  // Faza 4: imię i nazwisko (heurystyka)
  passProtectFictional(ctx);
  passPersonMixedCase(ctx); // przed wyzwalaczem „Pan/Pani”: inaczej wyzwalacz bierze imię, a nazwisko zostaje jawne
  passPersonRoleComplement(ctx);
  passPersonPairs(ctx);
  passPersonTrigger(ctx);
  passPersonStrongTrigger(ctx);
  passPersonSoloDict(ctx);
  passPersonInitial(ctx);
  passPersonHomographAnchor(ctx);
  passPersonForeign(ctx);
  passPersonSoloMorph(ctx);
  passPersonOcrTitle(ctx); // przed parą: para wzięłaby „tytuł + imię” i osierociła nazwisko
  passPersonOcrPair(ctx);
  passPersonOcrMix(ctx);
  passPersonMaidenAfterMask(ctx);
  passPersonParents(ctx);

  // Faza 5: domknięcia osób, stabilna numeracja, przywrócenie URL-i i ucieczek
  finalizePersons(ctx);
  passRestoreJsonEscapes(ctx);
  passJsonRequote(ctx); // na samym końcu: widzi tekst z przywróconymi ucieczkami

  const found: PiiFinding[] = [...counts.entries()].map(([type, count]) => ({ type, count }));
  return { redacted: ctx.text, found };
}

/** Czy tekst zawiera jakiekolwiek PII (np. do ostrzeżeń UI). */
export function hasPII(text: string): boolean {
  return redactPII(text).found.length > 0;
}

/** Unikalne etykiety dla ludzi, w kolejności wykrycia (kilka typów może mieć tę samą). */
export function describeFindings(found: PiiFinding[]): string[] {
  return [...new Set(found.map((f) => HUMAN_LABEL[f.type]))];
}
