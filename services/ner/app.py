"""
Anonimizator — opcjonalna LOKALNA usługa NER (spaCy PL) do wykrywania imion i nazwisk.

Rola: domknąć lukę recall, której nie złapie heurystyka słownikowa z packages/core
(rzadkie, odmienione nazwiska bez wyzwalacza kontekstu). Wykrywa encje OSOBOWE
(label `persName` w polskich modelach NKJP) i zamienia je na `[IMIĘ I NAZWISKO]`.

Prywatność/architektura:
- Usługa jest przeznaczona do uruchamiania NA KOMPUTERZE UŻYTKOWNIKA (localhost/Docker).
  Tekst nigdy nie idzie do podmiotu trzeciego — to jedyny sens NER w lokalnym anonimizerze.
- Klient (biblioteka `anonimizator/ner` lub aplikacja webowa) wysyła tekst JUŻ po redakcji
  strukturalnej: PESEL/NIP/IBAN są zamaskowane, ZANIM cokolwiek trafi do tej usługi.
- Auth opcjonalny: nagłówek `Authorization: Bearer <PII_NER_API_KEY>` (ustaw, jeśli
  wystawiasz usługę poza localhost).
- Pipeline ładowany WYŁĄCZNIE z komponentami NER (parser/lemmatizer/tagger wyłączone) → szybciej.

Domyślnie maskujemy tylko `persName`. Maskowania miejscowości (placeName/geogName) świadomie
NIE włączamy domyślnie — nazwa miasta to zwykle kontekst, nie dane osobowe; można dołączyć
przez PII_NER_LABELS.

Uruchomienie bez Dockera:
    pip install -r requirements.txt
    python -m spacy download pl_core_news_lg
    uvicorn app:app --host 127.0.0.1 --port 8090
"""

import os
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import spacy

MODEL = os.environ.get("PII_NER_MODEL", "pl_core_news_lg")
API_KEY = os.environ.get("PII_NER_API_KEY", "")
LABELS = {lbl.strip() for lbl in os.environ.get("PII_NER_LABELS", "persName").split(",") if lbl.strip()}
MASK = os.environ.get("PII_NER_MASK", "[IMIĘ I NAZWISKO]")
# CORS: "*" jest OK dla usługi na localhost (aplikacja webowa otwarta z file:// wysyła Origin: null).
# Zawęź, jeśli wystawiasz usługę poza własny komputer.
CORS_ORIGINS = [o.strip() for o in os.environ.get("PII_NER_CORS_ORIGINS", "*").split(",") if o.strip()]

# NER-only pipeline (drop wszystko, co niepotrzebne) → szybciej, mniej RAM.
_EXCLUDE = ["parser", "lemmatizer", "tagger", "attribute_ruler", "morphologizer", "senter"]
try:
    nlp = spacy.load(MODEL, exclude=_EXCLUDE)
except Exception as exc:  # noqa: BLE001
    raise RuntimeError(
        f"Nie udało się załadować modelu spaCy '{MODEL}'. "
        f"Zainstaluj: python -m spacy download {MODEL}. Błąd: {exc}"
    ) from exc

app = FastAPI(title="Anonimizator NER", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


class RedactRequest(BaseModel):
    text: str


def _check_auth(authorization: str) -> None:
    if API_KEY and authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL, "labels": sorted(LABELS)}


@app.post("/redact")
def redact(req: RedactRequest, authorization: str = Header(default="")):
    _check_auth(authorization)

    text = req.text or ""
    if not text:
        return {"redacted": text, "found": []}

    doc = nlp(text)
    spans = [ent for ent in doc.ents if ent.label_ in LABELS]
    if not spans:
        return {"redacted": text, "found": []}

    # Zamiana od końca (malejące offsety), żeby nie psuć pozycji wcześniejszych encji.
    chars = list(text)
    count = 0
    for ent in sorted(spans, key=lambda e: e.start_char, reverse=True):
        chars[ent.start_char:ent.end_char] = list(MASK)
        count += 1

    return {"redacted": "".join(chars), "found": [{"type": "IMIE", "count": count}]}
