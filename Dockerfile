# Schlankes Image ohne Headless-Browser. Der Stundenplan kommt über den KUSSS-iCal-Link.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend backend
COPY frontend frontend
WORKDIR /app/backend
EXPOSE 8000
# --forwarded-allow-ips: echte Client-IP hinter dem Fly-Proxy (für das Login-Rate-Limit)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
