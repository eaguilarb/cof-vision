# Servicio de conteo COF para Railway (CPU). Los modelos se bajan del sitio publicado al construir la imagen.
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN mkdir -p models && curl -fsSL -o models/cof-11n.onnx https://eaguilarb.github.io/cof-vision/models/cof-11n.onnx
COPY conteo.py app.py ./
ENV PORT=8080
CMD uvicorn app:app --host 0.0.0.0 --port ${PORT}
