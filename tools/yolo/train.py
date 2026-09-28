from ultralytics import YOLO
m = YOLO('yolov10s.pt')
# Se conservan las 80 clases (solo «person» etiquetada): no se reinicia la cabeza y no olvida lo que ya sabe.
m.train(data='ds/data80.yaml', epochs=25, imgsz=640, batch=8, workers=2, device='cpu', patience=8, freeze=10,
        optimizer='SGD', lr0=0.003, lrf=0.2, momentum=0.9, warmup_epochs=1, project='runs', name='cof80', exist_ok=True,
        plots=False, verbose=False, hsv_h=0.01, degrees=0, fliplr=0.5, mosaic=1.0, close_mosaic=5)
print('FIN', flush=True)
