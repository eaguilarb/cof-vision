"""Conteo de pasajeros en las puertas de un bus con supervision.

Detector ONNX (YOLO COF, RF-DETR o ambos combinados; todos con entrada [1,3,640,640] y salida [1,300,6] =
x0,y0,x1,y1 en px de 640, confianza, clase; clase 0 = persona) + ByteTrack + LineZone en el umbral de la puerta.
Suben = cruces de la línea hacia adentro (ancla en el centro de la persona, como lo calibramos con el LCSX54).
Bajan = personas que aparecen adentro y se ven por última vez afuera (lado neto: un paso atrás no suma bajadas).
"""
import cv2
import numpy as np
import onnxruntime as ort
import supervision as sv
import trackers


class Detector:
    def __init__(self, paths, threads=0):
        so = ort.SessionOptions()
        if threads:
            so.intra_op_num_threads = threads
        self.sess = [ort.InferenceSession(p, so, providers=['CPUExecutionProvider']) for p in paths]

    def __call__(self, bgr, conf=0.3):
        # La imagen se estira a 640x640 sin relleno (como hace rfdetr.predict): con relleno, una cámara 928x480
        # quedaba en 640x331 y las personas se veían a la mitad de tamaño.
        H, W = bgr.shape[:2]
        sx, sy = 640 / W, 640 / H
        x = (cv2.cvtColor(cv2.resize(bgr, (640, 640)), cv2.COLOR_BGR2RGB).astype(np.float32) / 255).transpose(2, 0, 1)[None]
        outs = []
        for s in self.sess:
            o = s.run(None, {s.get_inputs()[0].name: x})[0][0]
            outs.append(o[(o[:, 5] == 0) & (o[:, 4] >= conf)])
        o = np.concatenate(outs) if outs else np.zeros((0, 6), np.float32)
        xyxy = o[:, :4] / np.array([sx, sy, sx, sy], np.float32)
        d = sv.Detections(xyxy=xyxy.astype(np.float32), confidence=o[:, 4].astype(np.float32),
                          class_id=np.zeros(len(o), int))
        # Con dos detectores, la misma persona sale dos veces: se deja la caja de mayor confianza.
        return d.with_nms(threshold=0.6) if len(self.sess) > 1 and len(d) else d


def contar_puerta(video, t0, t1, linea, det, fps_det=12, conf=0.4, ancla='center'):
    """Cuenta en una puerta entre t0 y t1 (segundos del video). linea = (x0, y0, x1, y1) en píxeles, con el
    interior del bus al lado derecho al recorrerla de (x0,y0) a (x1,y1). ancla: 'center' (cámara cenital, los pies
    quedan fuera de la imagen) o 'bottom' (cámara de lado: cuentan los pies, como la línea dibujada en el escalón)."""
    v = cv2.VideoCapture(video)
    fps = v.get(cv2.CAP_PROP_FPS) or 25
    tr = trackers.ByteTrackTracker(lost_track_buffer=int(fps_det * 2), frame_rate=fps_det,
                                   track_activation_threshold=conf, minimum_consecutive_frames=2,
                                   high_conf_det_threshold=conf)
    # LineZone cuenta «in» hacia el lado izquierdo de start→end: se le pasa la línea al revés para que «in» = adentro.
    lz = sv.LineZone(start=sv.Point(linea[2], linea[3]), end=sv.Point(linea[0], linea[1]),
                     triggering_anchors=[sv.Position.CENTER if ancla == 'center' else sv.Position.BOTTOM_CENTER],
                     minimum_crossing_threshold=2)
    xa, xb = min(linea[0], linea[2]) - 40, max(linea[0], linea[2]) + 40
    (ax, ay), (bx, by) = linea[:2], linea[2:]
    lado = lambda x, y: (bx - ax) * (y - ay) - (by - ay) * (x - ax) > 0  # True = adentro
    i = int(t0 * fps)
    v.set(cv2.CAP_PROP_POS_FRAMES, i)
    nxt, side, suben_t, cajas = float(i), {}, [], []
    while i <= t1 * fps:
        if not v.grab():
            break
        if i >= nxt:
            nxt += fps / fps_det
            ok, f = v.retrieve()
            if not ok:
                break
            d = tr.update(det(f))
            if d.tracker_id is not None:
                d = d[d.tracker_id >= 0]
            cin, _ = lz.trigger(d)
            t = round(i / fps, 1)
            H, W = f.shape[:2]
            # Quién cruzó hacia adentro en esta foto, con su recuadro (en fracción de la imagen) para la foto de evidencia.
            for k in np.flatnonzero(cin):
                x0, y0, x1, y1 = d.xyxy[k]
                suben_t.append(t)
                cajas.append({'t': t, 'id': int(d.tracker_id[k]), 'caja': [round(float(x0) / W, 4), round(float(y0) / H, 4), round(float(x1) / W, 4), round(float(y1) / H, 4)]})
            if d.tracker_id is not None:
                for (x0, y0, x1, y1), tid in zip(d.xyxy, d.tracker_id):
                    cx, cy = (x0 + x1) / 2, ((y0 + y1) / 2 if ancla == 'center' else y1)
                    if xa <= cx <= xb:
                        side.setdefault(int(tid), []).append((t, lado(cx, cy)))
        i += 1
    bajan_t = sorted(h[-1][0] for h in side.values()
                     if len(h) >= 3 and h[0][1] and h[1][1] and not h[-1][1] and not h[-2][1])
    return {'suben': len(suben_t), 'bajan': len(bajan_t), 't_suben': suben_t, 't_bajan': bajan_t, 'cajas_suben': cajas}
