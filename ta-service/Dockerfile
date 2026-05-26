ARG PYTHON_IMAGE=python:3.13-slim@sha256:b04b5d7233d2ad9c379e22ea8927cd1378cd15c60d4ef876c065b25ea8fb3bf3
FROM ${PYTHON_IMAGE}

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py agent_reach.py finance_enrichment.py ./

ENV TA_PORT=8100
EXPOSE 8100

CMD ["python", "server.py"]
