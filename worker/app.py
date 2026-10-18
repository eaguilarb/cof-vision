"""Servicio de conteo COF (Railway): recibe los enlaces de los videos y las zonas de las puertas desde la página,
baja solo los tramos de cada detención (ffmpeg pide por rangos, no se descarga el video entero) y cuenta con
supervision. La página consulta el avance y recibe, por detención y por puerta, cuántos suben y bajan y cuándo.

Variables de entorno:
  WORKER_TOKEN    clave que la página manda en la cabecera Authorization (obligatoria)
  GOOGLE_API_KEY  clave de Google para bajar videos de Drive (si la página no manda la suya)
  MODELOS         rutas de los .onnx separadas por coma (por defecto los de /app/models)
  ORIGENES        orígenes permitidos para la página (por defecto el sitio publicado)
"""
import os, re, uuid, shutil, threading, subprocess, tempfile, time, traceback
import cv2
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from conteo import Detector, contar_puerta

TOKEN = os.environ.get('WORKER_TOKEN', '')
GKEY = os.environ.get('GOOGLE_API_KEY', '')
MODELOS = [p for p in os.environ.get('MODELOS', '/app/models/rfdetr-nano.onnx').split(',') if p]
ORIGENES = os.environ.get('ORIGENES', 'https://eaguilarb.github.io').split(',')

app = FastAPI(title='COF conteo')
app.add_middleware(CORSMiddleware, allow_origins=ORIGENES, allow_methods=['*'], allow_headers=['*'])
DET = None
JOBS = {}
LOCK = threading.Lock()  # un trabajo a la vez: el plan Hobby tiene 8 núcleos y el detector los usa todos


class Puerta(BaseModel):
    video: str                 # id de Drive o URL directa
    linea: list[float]         # [x0, y0, x1, y1] en fracción de la imagen (0-1), adentro a la derecha de x0,y0→x1,y1
    off: float = 0             # desfase de esta cámara respecto de la línea de tiempo de la página (s)
    fps: float = 12
    ancla: str = 'center'      # 'center' (cámara cenital) o 'bottom' (pies, cámara de lado)


class Trabajo(BaseModel):
    puertas: dict[str, Puerta]            # {"CH4": {...}, "CH2": {...}}
    tramos: list[list[float]]             # [[t0, t1], ...] en segundos de la línea de tiempo de la página
    gkey: str | None = None


def auth(a):
    if not TOKEN or a != f'Bearer {TOKEN}':
        raise HTTPException(401, 'Clave del servicio incorrecta')


def url_de(video, gkey):
    if os.environ.get('PERMITIR_LOCAL') == '1' and video.startswith('/') and os.path.exists(video):
        return video  # solo para pruebas en el propio equipo
    if re.match(r'^https?://', video):
        return video
    if not re.match(r'^[\w-]{20,}$', video):
        raise ValueError('Video no reconocido (se espera un id de Drive o una URL)')
    return f'https://www.googleapis.com/drive/v3/files/{video}?alt=media&supportsAllDrives=true&key={gkey}'


def tramo(url, t0, t1, dest):
    # Copia sin recodificar desde un cuadro clave antes de t0: ffmpeg solo pide por rangos los bytes de ese tramo.
    pre = 3.0
    s = max(0.0, t0 - pre)
    cmd = ['ffmpeg', '-v', 'error', '-y', '-ss', f'{s:.2f}', '-i', url, '-t', f'{t1 - s + 1:.2f}', '-an', '-c', 'copy', dest]
    subprocess.run(cmd, check=True, timeout=600)
    return s


def correr(jid, job: Trabajo):
    global DET
    J = JOBS[jid]
    tmp = tempfile.mkdtemp()
    try:
        with LOCK:
            J['estado'] = 'contando'
            if DET is None:
                DET = Detector(MODELOS)
            gkey = job.gkey or GKEY
            for k, (t0, t1) in enumerate(job.tramos):
                fila = {'t0': t0, 't1': t1}
                for cam, p in job.puertas.items():
                    dest = os.path.join(tmp, f'{cam}.mp4')
                    a, b = t0 + p.off, t1 + p.off
                    s = tramo(url_de(p.video, gkey), a, b, dest)
                    v = cv2.VideoCapture(dest); W, H = v.get(3), v.get(4); v.release()
                    lin = (p.linea[0] * W, p.linea[1] * H, p.linea[2] * W, p.linea[3] * H)
                    r = contar_puerta(dest, a - s, b - s, lin, DET, fps_det=p.fps, ancla='bottom' if p.ancla == 'bottom' else 'center')
                    r['t_suben'] = [round(t + s - p.off, 1) for t in r['t_suben']]
                    r['t_bajan'] = [round(t + s - p.off, 1) for t in r['t_bajan']]
                    for x in r['cajas_suben']: x['t'] = round(x['t'] + s - p.off, 1)
                    fila[cam] = r
                J['resultados'].append(fila)
                J['avance'] = [k + 1, len(job.tramos)]
            J['estado'] = 'listo'
    except Exception as e:
        J['estado'] = 'error'
        J['error'] = f'{type(e).__name__}: {e}'
        traceback.print_exc()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@app.get('/')
def salud():
    return {'ok': True, 'modelos': [os.path.basename(m) for m in MODELOS], 'trabajos': len(JOBS)}


@app.post('/trabajos')
def crear(job: Trabajo, authorization: str = Header(default='')):
    auth(authorization)
    jid = uuid.uuid4().hex[:12]
    JOBS[jid] = {'estado': 'en cola', 'avance': [0, len(job.tramos)], 'resultados': [], 'creado': time.time()}
    threading.Thread(target=correr, args=(jid, job), daemon=True).start()
    return {'id': jid}


@app.get('/trabajos/{jid}')
def ver(jid: str, authorization: str = Header(default='')):
    auth(authorization)
    if jid not in JOBS:
        raise HTTPException(404, 'No existe ese trabajo (el servicio se reinició)')
    return JOBS[jid]
