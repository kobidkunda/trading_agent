FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py agent_reach.py finance_enrichment.py ./

ENV TA_PORT=8100
EXPOSE 8100

CMD ["python", "server.py"]