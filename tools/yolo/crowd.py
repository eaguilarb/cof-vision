# Fotos de aglomeraciones (zona paga en hora punta) para entrenar al detector COF con gente muy apretada.
# El maestro (YOLO11x con aumento de prueba, imagen grande) etiqueta a las personas; el 20 % final de cada video queda
# para medir (nunca se entrena con esos segundos).
# Uso: python3 crowd.py salida/ video1.mp4:x,y,w,h[:etiqueta] video2.mp4 ...  (x,y,w,h opcional: recorte de un mosaico)
import os, sys, cv2
from ultralytics import YOLO

out = sys.argv[1]
FPS = float(os.environ.get('FPS', '3'))
for sub in ('images/train', 'images/val', 'labels/train', 'labels/val'):
    os.makedirs(os.path.join(out, sub), exist_ok=True)
teacher = YOLO(os.environ.get('TEACHER', 'yolo11x.pt'))
n_tr = n_va = n_box = 0
for spec in sys.argv[2:]:
    parts = spec.split(':')
    path, crop = parts[0], (tuple(int(v) for v in parts[1].split(',')) if len(parts) > 1 and parts[1] else None)
    tag = parts[2] if len(parts) > 2 else os.path.splitext(os.path.basename(path))[0]
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    step = max(1, round(fps / FPS))
    for i in range(0, total, step):
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, im = cap.read()
        if not ok:
            break
        if crop:
            x, y, w, h = crop
            im = im[y:y + h, x:x + w]
        H, W = im.shape[:2]
        r = teacher.predict(im, conf=0.35, classes=[0], imgsz=1280, augment=True, verbose=False)[0]
        split = 'val' if i >= total * 0.8 else 'train'
        name = f'{tag}_{i:05d}'
        cv2.imwrite(os.path.join(out, 'images', split, name + '.jpg'), im, [cv2.IMWRITE_JPEG_QUALITY, 92])
        with open(os.path.join(out, 'labels', split, name + '.txt'), 'w') as fh:
            for x0, y0, x1, y1 in r.boxes.xyxy.cpu().numpy():
                if (x1 - x0) < 8 or (y1 - y0) < 8:
                    continue
                fh.write(f'0 {(x0 + x1) / 2 / W:.5f} {(y0 + y1) / 2 / H:.5f} {(x1 - x0) / W:.5f} {(y1 - y0) / H:.5f}\n')
                n_box += 1
        if split == 'val':
            n_va += 1
        else:
            n_tr += 1
    print(tag, 'listo', flush=True)
print(f'fotos: {n_tr} para entrenar, {n_va} para medir · personas etiquetadas: {n_box}')
