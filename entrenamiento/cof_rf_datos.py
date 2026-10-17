# COF Vision · datos para entrenar RF-DETR (personas y cabezas) con los videos de los buses.
#
# Clases: 0 = persona, 1 = cabeza.
#  - Cabezas de las imágenes marcadas por Qwen (cof_datos): se usan tal cual (son la referencia).
#  - Personas de esas imágenes y personas + cabezas de los fotogramas nuevos de los videos: las marcan dos
#    «profesores» grandes (RF-DETR Large para personas y el detector de cabezas entrenado en Colab).
#  - Toda iluminación: día, noche e infrarrojo. Además se agregan copias en blanco y negro y con poca luz.
#  - Aglomeraciones: los fotogramas con mucha gente se repiten en el entrenamiento.
#  - La prueba (val) son solo imágenes con cabezas marcadas por Qwen, de momentos que no entran al entrenamiento.
import argparse, glob, json, os, random, shutil, subprocess, sys

import cv2
import numpy as np

# Cámaras de puerta (CH4 delantera, CH5 central, CH7 trasera) de las carpetas de video compartidas.
VIDEOS = {
    'pgby49_CH4': '1DmD3CCz3h2hD-pXgc2MLHlXcxBg9tSGR',
    'pgby49_CH5': '1AMeTGUAIeeP9KpCUieN0fH9d0XnhIqXW',
    'pgby49_CH7': '1nzxLljdXSlR8-yEo2YfEZiwJZWhs3NLT',
    'pgtv28_CH4': '11a6WgSglwKdsePWWTprA-C3nKw_q78Jx',
    'pgtv28_CH5': '15syhEZ8NL0ACrZiEzZEPl0q80UELQ8ni',
    'pgtv28_CH7': '12wxYnzy-hTCR_4Tj6d8f-VVB3_u-t5MJ',
    'skwd57_CH4': '11UBtPbT_AHuVKtUiYi1p0aHFHq4oFA7-',
    'skwd57_CH5': '19AJyyjWtNzUe1prYGM1JMii0S8l8oW-r',
    'skwd57_CH7': '1m763Lfj1PwI8Gu9rjO6nQpzzjc2yAR0d',
}
# Momentos que se dejan fuera del entrenamiento (segundos del video): la prueba (val) de PGTV-28 y las paradas de
# SKWD-57 contadas a mano, con las que después se compara el conteo.
VAL_WINDOWS = {'pgtv28': [(3650, 4250)], 'skwd57': [(185, 490), (660, 700), (1175, 1205)]}
NAMES = {0: 'persona', 1: 'cabeza'}


def sh(cmd):
    print('$', cmd, flush=True)
    subprocess.run(cmd, shell=True, check=True)


def write_labels(path, rows):
    with open(path, 'w') as f:
        for c, x, y, w, h in rows:
            f.write(f'{c} {x:.5f} {y:.5f} {w:.5f} {h:.5f}\n')


def read_labels(path):
    if not os.path.exists(path):
        return []
    out = []
    for line in open(path):
        p = line.split()
        if len(p) == 5:
            out.append((int(p[0]), *map(float, p[1:])))
    return out


def boxes(model, imgs, cls, conf, imgsz, augment=False):
    """Recuadros (x, y, w, h normalizados) de una clase en un lote de imágenes."""
    res = model.predict(imgs, imgsz=imgsz, conf=conf, iou=0.6, max_det=400, classes=[cls] if cls is not None else None,
                        augment=augment, verbose=False)
    out = []
    for r in res:
        b = r.boxes.xywhn.cpu().numpy() if len(r.boxes) else np.zeros((0, 4))
        c = r.boxes.conf.cpu().numpy() if len(r.boxes) else np.zeros((0,))
        out.append([(tuple(map(float, v)), float(k)) for v, k in zip(b, c) if v[2] * v[3] > 0.0004])
    return out


class RFProfe:
    """RF-DETR Large (COCO) como profesor de personas, con la misma salida que boxes() de YOLO."""
    def __init__(self):
        import rfdetr
        self.m = rfdetr.RFDETRLarge()
        try:
            self.m.optimize_for_inference()
        except Exception as e:
            print('RF-DETR sin optimizar:', e)

    def boxes(self, imgs, conf):
        from PIL import Image
        ims = [Image.open(p).convert('RGB') if isinstance(p, str) else Image.fromarray(cv2.cvtColor(p, cv2.COLOR_BGR2RGB)) for p in imgs]
        out = []
        for k in range(0, len(ims), 8):
            ds = self.m.predict(ims[k:k + 8], threshold=conf)
            ds = ds if isinstance(ds, list) else [ds]
            for im, d in zip(ims[k:k + 8], ds):
                W, H = im.size
                r = []
                for (x0, y0, x1, y1), c, cl in zip(d.xyxy, d.confidence, d.class_id):
                    if int(cl) != 1:  # COCO: 1 = persona
                        continue
                    w, h = (x1 - x0) / W, (y1 - y0) / H
                    if w * h > 0.0004:
                        r.append((((x0 + x1) / 2 / W, (y0 + y1) / 2 / H, w, h), float(c)))
                out.append(r)
        return out


def only(bs):
    return [b for b, _ in bs]


def iou(a, b):
    ax0, ay0, ax1, ay1 = a[0] - a[2] / 2, a[1] - a[3] / 2, a[0] + a[2] / 2, a[1] + a[3] / 2
    bx0, by0, bx1, by1 = b[0] - b[2] / 2, b[1] - b[3] / 2, b[0] + b[2] / 2, b[1] + b[3] / 2
    iw, ih = max(0, min(ax1, bx1) - max(ax0, bx0)), max(0, min(ay1, by1) - max(ay0, by0))
    inter = iw * ih
    return inter / (a[2] * a[3] + b[2] * b[3] - inter + 1e-9)


def clean_heads(qwen, teacher, teacher_conf, persons):
    """Control cruzado: una cabeza de Qwen se queda si el detector de cabezas también la ve o si cae en la parte de
    arriba de una persona (así se van las marcas sobre el texto de la pantalla o reflejos). Las cabezas que Qwen no
    marcó y el detector ve con confianza alta (≥0.55) se agregan: en las multitudes Qwen se salta algunas."""
    keep = []
    for h in qwen:
        in_person = any(abs(h[0] - p[0]) < p[2] / 2 and p[1] - p[3] / 2 - 0.02 <= h[1] <= p[1] for p in persons)
        if in_person or any(iou(h, t) >= 0.3 for t in teacher):
            keep.append(h)
    for t, c in zip(teacher, teacher_conf):
        if c >= 0.55 and not any(iou(t, h) >= 0.3 for h in keep):
            keep.append(t)
    return keep


def is_mono(img):
    b, g, r = cv2.split(img.astype(np.int16))
    return float(np.mean(np.abs(b - g)) + np.mean(np.abs(g - r))) < 6


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--datos', required=True, help='carpeta con cof_cabezas_parte*.zip')
    ap.add_argument('--trabajo', required=True, help='carpeta local de trabajo')
    ap.add_argument('--cabezas_profe', required=True, help='modelo de cabezas para marcar los fotogramas nuevos (.pt)')
    ap.add_argument('--videos', default='/content/videos')
    ap.add_argument('--cada', type=float, default=1.5, help='segundos entre fotogramas candidatos')
    ap.add_argument('--por_video', type=int, default=650, help='fotogramas nuevos por video')
    ap.add_argument('--test', action='store_true', help='prueba rápida (pocas imágenes)')
    ap.add_argument('--solo', default='', help='solo estos videos (separados por coma), para pruebas')
    a = ap.parse_args()
    from ultralytics import YOLO
    T = a.trabajo
    ds = f'{T}/cof_personas_cabezas'
    if os.path.exists(f'{ds}/listo.txt'):
        print('El conjunto de datos ya estaba armado:', ds)
        return
    shutil.rmtree(ds, ignore_errors=True)
    for s in ('train', 'val'):
        os.makedirs(f'{ds}/images/{s}', exist_ok=True)
        os.makedirs(f'{ds}/labels/{s}', exist_ok=True)

    # 1) Imágenes con cabezas marcadas por Qwen.
    base = f'{T}/base'
    if not os.path.exists(f'{base}/cof_cabezas/data.yaml'):
        os.makedirs(base, exist_ok=True)
        for z in sorted(glob.glob(f'{a.datos}/*parte*.zip')):
            sh(f'unzip -q -o "{z}" -d "{base}"')
    profe_p = RFProfe()
    profe_c = YOLO(a.cabezas_profe)
    stats = {'base': 0, 'video': 0, 'gris': 0, 'oscura': 0, 'multitud_extra': 0}
    for s in ('train', 'val'):
        ims = sorted(glob.glob(f'{base}/cof_cabezas/images/{s}/*.jpg'))
        if a.test:
            ims = ims[:24]
        for i in range(0, len(ims), 16):
            chunk = ims[i:i + 16]
            pers = profe_p.boxes(chunk, 0.40)
            tch = boxes(profe_c, chunk, None, 0.25, 960, augment=True)
            for p, pb, th in zip(chunk, pers, tch):
                n = os.path.splitext(os.path.basename(p))[0]
                qwen = [tuple(r[1:]) for r in read_labels(f'{base}/cof_cabezas/labels/{s}/{n}.txt')]
                heads = clean_heads(qwen, only(th), [k for _, k in th], only(pb))
                stats['cabezas_qwen'] = stats.get('cabezas_qwen', 0) + len(qwen)
                stats['cabezas_finales'] = stats.get('cabezas_finales', 0) + len(heads)
                shutil.copy(p, f'{ds}/images/{s}/{n}.jpg')
                write_labels(f'{ds}/labels/{s}/{n}.txt', [(0, *b) for b in only(pb)] + [(1, *h) for h in heads])
                stats['base'] += 1
        print(s, len(ims), 'imágenes base con personas agregadas', flush=True)

    # 2) Fotogramas nuevos de los videos (toda la grabación: día, noche, infrarrojo), sobre todo con mucha gente.
    os.makedirs(a.videos, exist_ok=True)
    rng = random.Random(7)
    for name, fid in VIDEOS.items():
        if a.solo and name not in a.solo.split(','):
            continue
        mp4 = f'{a.videos}/{name}.mp4'
        if not os.path.exists(mp4) or os.path.getsize(mp4) < 1e6:
            sh(f'curl -sL -o "{mp4}" "https://drive.usercontent.google.com/download?id={fid}&export=download&confirm=t"')
        cap = cv2.VideoCapture(mp4)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25
        dur = (cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0) / fps
        if a.test:
            dur = min(dur, 240)
        bus = name.split('_')[0]
        wins = VAL_WINDOWS.get(bus, [])
        cand = []
        t = 0.0
        while t < dur:
            if not any(w0 <= t <= w1 for w0, w1 in wins):
                cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
                ok, f = cap.read()
                if ok:
                    cand.append((t, cv2.resize(f, (640, round(640 * f.shape[0] / f.shape[1])))))
            t += a.cada
            # Se cuentan personas por tandas para no llenar la memoria.
            if len(cand) >= 256 or t >= dur:
                cnt = [len(b) for b in profe_p.boxes([c[1] for c in cand], 0.45)] if cand else []
                for (tt, f), k in zip(cand, cnt):
                    if k >= 6 or (k >= 2 and rng.random() < 0.35) or (k == 0 and rng.random() < 0.02):
                        cv2.imwrite(f'{a.videos}/{name}_{int(tt * 10):06d}_{k:02d}.jpg', f, [cv2.IMWRITE_JPEG_QUALITY, 90])
                cand = []
        sel = sorted(glob.glob(f'{a.videos}/{name}_*.jpg'))
        # Primero las multitudes, después el resto, hasta el tope por video.
        sel.sort(key=lambda p: -int(p[-6:-4]))
        sel = sel[:(40 if a.test else a.por_video)]
        for i in range(0, len(sel), 16):
            chunk = sel[i:i + 16]
            pers = profe_p.boxes(chunk, 0.40)
            heads = boxes(profe_c, chunk, None, 0.30, 960, augment=True)
            for p, pb, hb in zip(chunk, pers, heads):
                n = os.path.splitext(os.path.basename(p))[0]
                shutil.copy(p, f'{ds}/images/train/{n}.jpg')
                write_labels(f'{ds}/labels/train/{n}.txt', [(0, *b) for b in only(pb)] + [(1, *b) for b in only(hb)])
                stats['video'] += 1
        print(name, len(sel), 'fotogramas nuevos', flush=True)

    # 3) Iluminación: copias en blanco y negro (como el infrarrojo) y con poca luz; multitudes repetidas.
    rng = random.Random(11)
    for p in sorted(glob.glob(f'{ds}/images/train/*.jpg')):
        n = os.path.splitext(os.path.basename(p))[0]
        lab = read_labels(f'{ds}/labels/train/{n}.txt')
        img = cv2.imread(p)
        if img is None:
            continue
        if not is_mono(img) and rng.random() < 0.30:
            g = cv2.cvtColor(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
            cv2.imwrite(f'{ds}/images/train/{n}_gris.jpg', g, [cv2.IMWRITE_JPEG_QUALITY, 90])
            write_labels(f'{ds}/labels/train/{n}_gris.txt', lab)
            stats['gris'] += 1
        if rng.random() < 0.15:
            d = np.clip(255 * (img / 255.0) ** 1.8 * 0.7, 0, 255).astype(np.uint8)
            cv2.imwrite(f'{ds}/images/train/{n}_oscura.jpg', d, [cv2.IMWRITE_JPEG_QUALITY, 90])
            write_labels(f'{ds}/labels/train/{n}_oscura.txt', lab)
            stats['oscura'] += 1
        if sum(1 for r in lab if r[0] == 0) >= 8 or sum(1 for r in lab if r[0] == 1) >= 8:
            shutil.copy(p, f'{ds}/images/train/{n}_multitud.jpg')
            write_labels(f'{ds}/labels/train/{n}_multitud.txt', lab)
            stats['multitud_extra'] += 1
    with open(f'{ds}/data.yaml', 'w') as f:
        f.write(f'path: {ds}\ntrain: images/train\nval: images/val\nnames:\n  0: persona\n  1: cabeza\n')
    stats['train_total'] = len(glob.glob(f'{ds}/images/train/*.jpg'))
    stats['val_total'] = len(glob.glob(f'{ds}/images/val/*.jpg'))
    json.dump(stats, open(f'{ds}/listo.txt', 'w'))
    print('Conjunto de datos listo:', stats, flush=True)


if __name__ == '__main__':
    sys.exit(main())
