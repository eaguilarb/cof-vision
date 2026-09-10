import {
  env,
  pipeline,
  RawImage,
  type ImageToTextPipeline,
  type ProgressInfo,
} from '@huggingface/transformers'

// Todo corre localmente en el navegador: no se sube ningún fotograma a ningún
// servidor y no se necesita API key ni conexión luego de la primera carga.
env.allowLocalModels = false

const MODEL_ID = 'Xenova/vit-gpt2-image-captioning'

export interface CaptionLoadProgress {
  loaded: number
  total: number
  progress: number
}

let pipelinePromise: Promise<ImageToTextPipeline> | null = null

/**
 * Carga (una sola vez) el modelo de descripción de imágenes.
 * Usa dtype "fp32" (sin cuantizar): la variante cuantizada "q8" de este
 * modelo falla al crear la sesión en el motor WASM del navegador
 * (le falta un tensor de escala para el peso del embedding del decoder),
 * aunque funcione en otros motores — fp32 pesa más pero es la variante
 * que sí corre de forma confiable en el navegador.
 */
export function loadCaptioner(onProgress?: (info: CaptionLoadProgress) => void): Promise<ImageToTextPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = pipeline('image-to-text', MODEL_ID, {
      dtype: 'fp32',
      progress_callback: (info: ProgressInfo) => {
        if (info.status === 'progress_total') {
          onProgress?.({ loaded: info.loaded, total: info.total, progress: info.progress })
        }
      },
    }) as Promise<ImageToTextPipeline>
  }
  return pipelinePromise
}

/** Genera una descripción en texto de un fotograma capturado en un <canvas>. */
export async function captionFrame(captioner: ImageToTextPipeline, canvas: HTMLCanvasElement): Promise<string> {
  const image = RawImage.fromCanvas(canvas)
  const output = await captioner(image, { max_new_tokens: 40 })
  const [first] = Array.isArray(output) ? output : [output]
  return (first?.generated_text ?? '').trim()
}
