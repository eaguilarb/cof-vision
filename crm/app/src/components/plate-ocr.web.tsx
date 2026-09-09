import { forwardRef, useImperativeHandle } from 'react';

export interface PlateOcrHandle {
  recognize: (base64Jpeg: string) => Promise<string>;
}

// En web corremos Tesseract.js directo en la página (el navegador ya
// soporta WebAssembly) — gratis, sin API ni costo por imagen, la librería
// se carga una sola vez desde CDN y el navegador la cachea.
let tesseractLoadPromise: Promise<any> | null = null;

function loadTesseract(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No hay DOM disponible'));
  if ((window as any).Tesseract) return Promise.resolve((window as any).Tesseract);
  if (!tesseractLoadPromise) {
    tesseractLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      script.onload = () => resolve((window as any).Tesseract);
      script.onerror = () => reject(new Error('No se pudo cargar el motor de reconocimiento de texto'));
      document.head.appendChild(script);
    });
  }
  return tesseractLoadPromise;
}

export const PlateOcrRunner = forwardRef<PlateOcrHandle>((_props, ref) => {
  useImperativeHandle(ref, () => ({
    async recognize(base64: string) {
      const Tesseract = await loadTesseract();
      const worker = await Tesseract.createWorker('eng');
      await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' });
      const result = await worker.recognize(`data:image/jpeg;base64,${base64}`);
      await worker.terminate();
      return (result.data.text as string) || '';
    },
  }));

  return null;
});

PlateOcrRunner.displayName = 'PlateOcrRunner';
