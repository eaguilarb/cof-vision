import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { api, getApiBaseUrl, getAuthHeaders, getModule } from '@/api/client';

const MIME: Record<'xlsx' | 'pdf', string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/**
 * Descarga /reports/export en el formato pedido. En web dispara la
 * descarga del navegador; en Android/iOS baja el archivo con FileSystem y
 * abre el selector de "Compartir/Abrir con" (no hay carpeta de Descargas
 * accesible directamente desde una app instalada fuera de Play Store).
 */
export async function downloadExport(format: 'xlsx' | 'pdf'): Promise<void> {
  const filename = `casos-cof-${new Date().toISOString().slice(0, 10)}.${format}`;
  const module = getModule();

  if (Platform.OS === 'web') {
    const res = await api.get('/reports/export', { params: { format, module }, responseType: 'blob' });
    const blob = res.data as Blob;
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
    return;
  }

  const url = `${getApiBaseUrl()}/reports/export?format=${format}${module ? `&module=${module}` : ''}`;
  const destinationFile = new File(Paths.cache, filename);
  if (destinationFile.exists) destinationFile.delete();
  const file = await File.downloadFileAsync(url, destinationFile, { headers: getAuthHeaders(), idempotent: true });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: MIME[format], dialogTitle: filename });
  }
}
