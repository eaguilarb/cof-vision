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

export type CaptionModelStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface CaptionLoadProgress {
  loaded: number
  total: number
  progress: number
}

let pipelinePromise: Promise<ImageToTextPipeline> | null = null

/** Carga (una sola vez) el modelo de descripción de imágenes, en cuantización q8 para pesar menos. */
export function loadCaptioner(onProgress?: (info: CaptionLoadProgress) => void): Promise<ImageToTextPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = pipeline('image-to-text', MODEL_ID, {
      dtype: 'q8',
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
