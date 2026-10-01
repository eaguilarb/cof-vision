# Fotos de las detenciones de una expedición completa (las 3 cámaras) etiquetadas por el maestro YOLO11x.
# Uso: python3 stops_frames.py salida/ stops.json corte_s cam1.mp4:etiqueta cam2.mp4:etiqueta ...
# stops.json = [[t0, t1], ...] en segundos del video; las detenciones que parten después de «corte_s» quedan para medir.
import os, sys, json, cv2
from ultralytics import YOLO
out, stops, cut = sys.argv[1], json.load(open(sys.argv[2])), float(sys.argv[3])
EVERY = float(os.environ.get('EVERY', '3'))
for sub in ('images/train', 'images/val', 'labels/train', 'labels/val'):
    os.makedirs(os.path.join(out, sub), exist_ok=True)
teacher = YOLO(os.environ.get('TEACHER', 'yolo11x.pt'))
nb = 0
for spec in sys.argv[4:]:
    path, tag = spec.split(':')
    cap = cv2.VideoCapture(path)
    for t0, t1 in stops:
        t = t0
        while t <= t1:
            split = 'val' if t0 >= cut else 'train'
            name = f'{tag}_{int(t * 10):06d}'
            # Ya etiquetada (si el proceso se cortó y se vuelve a lanzar, sigue donde quedó).
            if os.path.exists(os.path.join(out, 'labels', split, name + '.txt')):
                t += EVERY
                continue
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ok, im = cap.read()
            if ok:
                H, W = im.shape[:2]
                r = teacher.predict(im, conf=0.35, classes=[0], imgsz=1280, verbose=False)[0]
                cv2.imwrite(os.path.join(out, 'images', split, name + '.jpg'), im, [cv2.IMWRITE_JPEG_QUALITY, 92])
                with open(os.path.join(out, 'labels', split, name + '.txt'), 'w') as fh:
                    for x0, y0, x1, y1 in r.boxes.xyxy.cpu().numpy():
                        if (x1 - x0) < 8 or (y1 - y0) < 8:
                            continue
                        fh.write(f'0 {(x0 + x1) / 2 / W:.5f} {(y0 + y1) / 2 / H:.5f} {(x1 - x0) / W:.5f} {(y1 - y0) / H:.5f}\n')
                        nb += 1
            t += EVERY
        print(tag, t0, 'listo', flush=True)
print('personas etiquetadas:', nb)
