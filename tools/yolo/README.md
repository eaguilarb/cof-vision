# Entrenamiento del detector de personas (YOLO) para las cámaras de los buses

El contador de `camara.html` usa un YOLOv10s afinado con fotos de las cámaras de puerta (modelo **COF**),
publicado en `https://eaguilarb.github.io/cof-vision/models/cof-v2.onnx`. Si no se puede descargar, usa el
YOLOv10s general.

## Cómo se entrenó (cof-v1)

1. **Fotos**: videos originales del DVR (no grabaciones de pantalla), 2 fotos por segundo, en `raw/`.
2. **Etiquetas** (`teach.py`): YOLO11x con aumento en prueba (imgsz 960) marca a las personas.
3. **Datos** (`build.py`): se quedan las cajas con confianza ≥ 0,40, sin duplicados, y se agregan las personas
   que el profesor perdió en una foto pero vio en la anterior y en la siguiente. Un paradero de cada video queda
   aparte para evaluar (no se entrena con él).
4. **Entrenamiento** (`train.py`): YOLOv10s partiendo del modelo COCO, conservando las 80 clases (solo «person»
   etiquetada) y congelando las primeras 10 capas, 25 épocas con parada temprana.
5. **Exportación** para el navegador: `YOLO('best.pt').export(format='onnx', imgsz=640, opset=17, simplify=True, end2end=True)`
   → salida `[1, 300, 6]` (x0, y0, x1, y1, confianza, clase), igual que el modelo general.

Resultado en fotos de evaluación (paraderos no vistos al entrenar), confianza 0,25:

| Modelo | Precisión | Personas encontradas |
|---|---|---|
| YOLOv10s general | 0,80 | 0,65 |
| COF v1 | 0,80 | 0,77 |

## Para agregar cámaras (CH5, CH7, otros buses)

Agregar los videos originales de esas cámaras a `raw/`, repetir los pasos 2 a 5 y publicar el `.onnx` nuevo
(`cof-v2.onnx`) cambiando `YOLO_COF` en `camara.html`.

## cof-v2 (3 puertas)

Se agregaron las cámaras CH4, CH5 y CH7 del PFZK-82 (1 foto por segundo, 769 fotos) a los datos de cof-v1 y se siguió
entrenando desde cof-v1 (979 fotos de entrenamiento, ~2.200 personas). Evaluación en 268 fotos no vistas (incluye las
3 puertas del PFZK-82), confianza 0,25:

| Modelo | Precisión | Personas encontradas | mAP50 |
|---|---|---|---|
| YOLOv10s general | 0,83 | 0,47 | 0,46 |
| COF v1 | 0,62 | 0,68 | 0,59 |
| COF v2 | 0,85 | 0,77 | 0,80 |
