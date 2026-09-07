import { useEffect, useState } from 'react';
import { Image, Platform, View, type ImageStyle, type StyleProp } from 'react-native';
import { api, getAuthHeaders } from '@/api/client';

/**
 * Imagen que requiere el header de Authorization para descargarse.
 * En nativo (Android/iOS), <Image> soporta headers directamente. En web,
 * la etiqueta <img> del navegador no puede mandar headers propios, así
 * que ahí la bajamos con fetch autenticado y la mostramos como blob URL.
 */
export function AuthImage({ uri, style }: { uri: string; style?: StyleProp<ImageStyle> }) {
  const [webSrc, setWebSrc] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let objectUrl: string | null = null;
    let cancelled = false;

    (async () => {
      try {
        const res = await api.get<Blob>(uri, { responseType: 'blob' });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setWebSrc(objectUrl);
      } catch {
        // Se deja sin imagen; el contenedor visible es suficiente feedback.
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uri]);

  if (Platform.OS === 'web') {
    if (!webSrc) return <View style={style} />;
    return <Image source={{ uri: webSrc }} style={style} />;
  }

  return <Image source={{ uri, headers: getAuthHeaders() }} style={style} />;
}
