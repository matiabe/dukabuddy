FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TZ=Africa/Nairobi
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY *.py ./

RUN useradd --create-home --uid 1000 dukabuddy
USER dukabuddy

EXPOSE 5000
# One worker (the automation scheduler and login throttling live in this process), several threads for staff devices
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "8", "--timeout", "120", "--access-logfile", "-", "app:app"]
