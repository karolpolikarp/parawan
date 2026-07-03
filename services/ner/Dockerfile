FROM python:3.12-slim

# Model do wyboru w czasie budowania: pl_core_news_lg (najlepszy) lub pl_core_news_md (lżejszy).
ARG SPACY_MODEL=pl_core_news_lg
ENV PII_NER_MODEL=${SPACY_MODEL}

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && python -m spacy download ${SPACY_MODEL}

COPY app.py .

EXPOSE 8090
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090"]
