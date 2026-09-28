# Etiquetado automático con el modelo grande (profesor) + aumento en prueba. Guarda cajas con su confianza.
from ultralytics import YOLO
import glob, json
m = YOLO('yolo11x.pt')
out = {}
fs = sorted(glob.glob('raw/*.jpg'))
for k in range(0, len(fs), 8):
    for f, r in zip(fs[k:k+8], m.predict(fs[k:k+8], imgsz=960, augment=True, conf=0.15, classes=[0], verbose=False)):
        out[f] = [[*map(float, b.xyxyn[0].tolist()), float(b.conf)] for b in r.boxes]
    json.dump(out, open('teacher.json', 'w'))
    print(k, flush=True)
print('FIN', flush=True)
