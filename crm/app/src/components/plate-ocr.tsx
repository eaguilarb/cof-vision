import { forwardRef, useImperativeHandle, useRef } from 'react';
import { View } from 'react-native';
import WebView from 'react-native-webview';

export interface PlateOcrHandle {
  recognize: (base64Jpeg: string) => Promise<string>;
}

// Corre Tesseract.js (OCR gratis, sin API ni costo por imagen) dentro de un
// WebView oculto: Hermes (el motor JS de React Native) no soporta
// WebAssembly, así que necesitamos un motor con DOM/WASM real. La librería
// se descarga desde CDN la primera vez (el navegador del WebView la cachea).
const HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js" onerror="postError('No se pudo cargar el motor OCR (revisa la conexión a internet).')"></script>
</head><body>
<script>
  function postError(msg) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ ok: false, error: msg }));
  }
  var worker = null;
  async function getWorker() {
    if (worker) return worker;
    // workerBlobURL:false evita crear el worker vía blob: URL, que algunos
    // WebView de Android bloquean cuando la página no tiene un origen http(s)
    // real (aquí se carga desde un string HTML en memoria, no desde una URL).
    worker = await Tesseract.createWorker('eng', 1, { workerBlobURL: false });
    await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' });
    return worker;
  }
  async function run(base64) {
    if (typeof Tesseract === 'undefined') {
      postError('El motor OCR no cargó (sin internet en el dispositivo).');
      return;
    }
    try {
      var w = await getWorker();
      var result = await w.recognize('data:image/jpeg;base64,' + base64);
      window.ReactNativeWebView.postMessage(JSON.stringify({ ok: true, text: result.data.text || '' }));
    } catch (e) {
      postError(String(e && e.message ? e.message : e));
    }
  }
  document.addEventListener('message', function (e) { run(e.data); });
  window.addEventListener('message', function (e) { run(e.data); });
</script>
</body></html>`;

const RECOGNIZE_TIMEOUT_MS = 25000;

export const PlateOcrRunner = forwardRef<PlateOcrHandle>((_props, ref) => {
  const webviewRef = useRef<WebView>(null);
  const pending = useRef<{ resolve: (v: string) => void; reject: (e: unknown) => void } | null>(null);

  useImperativeHandle(ref, () => ({
    recognize(base64: string) {
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (pending.current?.resolve === resolve) {
            pending.current = null;
            reject(new Error('Tiempo de espera agotado leyendo la patente.'));
          }
        }, RECOGNIZE_TIMEOUT_MS);
        pending.current = {
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        };
        webviewRef.current?.postMessage(base64);
      });
    },
  }));

  return (
    <View style={{ width: 1, height: 1, opacity: 0, position: 'absolute', top: -1000 }} pointerEvents="none">
      <WebView
        ref={webviewRef}
        originWhitelist={['*']}
        source={{ html: HTML, baseUrl: 'https://cdn.jsdelivr.net/' }}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        allowFileAccess
        onError={() => pending.current?.reject(new Error('No se pudo cargar el motor OCR.'))}
        onMessage={(event) => {
          const current = pending.current;
          pending.current = null;
          if (!current) return;
          try {
            const data = JSON.parse(event.nativeEvent.data);
            if (data.ok) current.resolve(data.text);
            else current.reject(new Error(data.error));
          } catch (e) {
            current.reject(e);
          }
        }}
      />
    </View>
  );
});

PlateOcrRunner.displayName = 'PlateOcrRunner';
