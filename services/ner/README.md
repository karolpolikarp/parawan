# Anonimizator NER — opcjonalna lokalna usługa (spaCy PL)

Usługa wykrywania **imion i nazwisk** (encje osobowe) podnosząca skuteczność anonimizatora.
Domyka lukę, której nie złapie warstwa regex+słownik: rzadkie i odmienione nazwiska bez
wyzwalacza kontekstu („Wczoraj Bąkiewicz podpisał umowę z Szczepankowską").

**Uruchamiasz ją na własnym komputerze** — tekst nadal nie opuszcza Twojej maszyny.
Bez tej usługi anonimizator działa normalnie (sama warstwa regex + sumy kontrolne).

## Architektura (fail-safe)

```
aplikacja webowa / biblioteka (anonimizator/ner)
  1. redakcja in-process: PESEL/NIP/IBAN/dowód/e-mail/telefon/adres + heurystyka imion
  2. tekst JUŻ zredagowany strukturalnie ──HTTP POST /redact──► ta usługa (localhost:8090)
  3. spaCy maskuje pozostałe osoby → [IMIĘ I NAZWISKO]
```

**Fail-safe:** gdy usługa jest wyłączona/niedostępna/przekroczy timeout — klient zostaje
przy wyniku warstwy regex. Ochrona nigdy nie spada poniżej poziomu in-process.
Usługa **nigdy nie widzi** surowego PESEL/NIP — te są maskowane, zanim tekst tu trafi.

## Najprościej: Docker

```bash
cd services/ner
docker compose up -d          # buduje obraz (pobiera model ~500 MB) i startuje na 127.0.0.1:8090
curl http://localhost:8090/health
```

Potem w aplikacji webowej zaznacz „Użyj lokalnego NER" — status zmieni się na „aktywny".

## Bez Dockera (Python 3.9+)

```bash
cd services/ner
python -m venv .venv && .venv/Scripts/activate    # Windows (Linux/macOS: source .venv/bin/activate)
pip install -r requirements.txt
python -m spacy download pl_core_news_lg
uvicorn app:app --host 127.0.0.1 --port 8090
```

## API

- `GET /health` → `{ "status": "ok", "model": "...", "labels": ["persName"] }`
- `POST /redact` (opcjonalny nagłówek `Authorization: Bearer <PII_NER_API_KEY>`)
  - body: `{ "text": "Sprawę prowadzi Bąkiewicz" }`
  - resp: `{ "redacted": "Sprawę prowadzi [IMIĘ I NAZWISKO]", "found": [{"type":"IMIE","count":1}] }`

## Konfiguracja (zmienne środowiskowe / `.env`)

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `PII_NER_MODEL` | `pl_core_news_lg` | `pl_core_news_md` gdy mało RAM |
| `PII_NER_API_KEY` | *(puste = brak auth)* | ustaw, jeśli wystawiasz poza localhost |
| `PII_NER_LABELS` | `persName` | NKJP; `placeName,geogName` dołącz świadomie |
| `PII_NER_MASK` | `[IMIĘ I NAZWISKO]` | musi pasować do maski warstwy regex |
| `PII_NER_CORS_ORIGINS` | `*` | zawęź poza localhost |

## Użycie z biblioteki

```ts
import { redactPIIFull } from 'anonimizator/ner';

const { redacted } = await redactPIIFull(tekst, { url: 'http://127.0.0.1:8090' });
// NER niedostępny? Dostajesz wynik warstwy regex — nigdy mniej.
```

## Wydajność

Pipeline ładowany tylko z komponentami NER (parser/tagger/lemmatizer wyłączone) —
krótki tekst to kilkadziesiąt ms. Długie dokumenty klient przycina (`maxChars`,
domyślnie 20 000 znaków), ogon zostaje na wyniku warstwy regex.
