# Servicio de conteo COF para Railway (CPU).
# Etapa 1: exporta RF-DETR Nano (pesos oficiales de Roboflow, personas COCO) a ONNX. Pesa 108 MB, más que el límite de
# GitHub por archivo, por eso se arma al construir la imagen en vez de guardarlo en el repositorio.
FROM python:3.11-slim AS modelo
RUN pip install --no-cache-dir torch==2.7.1 torchvision==0.22.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir rfdetr==1.11.2 transformers==5.20.1 onnx==1.17.0
WORKDIR /m
COPY exportar_rfdetr.py .
RUN python exportar_rfdetr.py nano - /m/rfdetr-nano.onnx

# Etapa 2: servicio liviano (sin torch): onnxruntime + supervision + ffmpeg.
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 && pip uninstall -y opencv-python \
 && pip install --no-cache-dir --force-reinstall --no-deps opencv-python-headless==4.10.0.84
COPY --from=modelo /m/rfdetr-nano.onnx /app/models/rfdetr-nano.onnx
COPY conteo.py app.py ./
ENV PORT=8080 MODELOS=/app/models/rfdetr-nano.onnx
CMD uvicorn app:app --host 0.0.0.0 --port ${PORT}
