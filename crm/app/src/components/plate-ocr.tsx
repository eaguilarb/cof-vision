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
<script src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"></script>
</head><body>
<script>
  async function run(base64) {
    try {
      var worker = await Tesseract.createWorker('eng');
      await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' });
      var result = await worker.recognize('data:image/jpeg;base64,' + base64);
      await worker.terminate();
      window.ReactNativeWebView.postMessage(JSON.stringify({ ok: true, text: result.data.text || '' }));
    } catch (e) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ ok: false, error: String(e) }));
    }
  }
  document.addEventListener('message', function (e) { run(e.data); });
  window.addEventListener('message', function (e) { run(e.data); });
</script>
</body></html>`;

export const PlateOcrRunner = forwardRef<PlateOcrHandle>((_props, ref) => {
  const webviewRef = useRef<WebView>(null);
  const pending = useRef<{ resolve: (v: string) => void; reject: (e: unknown) => void } | null>(null);

  useImperativeHandle(ref, () => ({
    recognize(base64: string) {
      return new Promise<string>((resolve, reject) => {
        pending.current = { resolve, reject };
        webviewRef.current?.postMessage(base64);
      });
    },
  }));

  return (
    <View style={{ width: 1, height: 1, opacity: 0, position: 'absolute', top: -1000 }} pointerEvents="none">
      <WebView
        ref={webviewRef}
        originWhitelist={['*']}
        source={{ html: HTML }}
        javaScriptEnabled
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
