import Anthropic from '@anthropic-ai/sdk'

// claude-haiku-4-5: el modelo más rápido y barato de Anthropic, ideal para
// describir fotogramas de video cada pocos segundos sin costar mucho.
const MODEL_ID = 'claude-haiku-4-5'
const MAX_FRAME_WIDTH = 640

export function createCaptionClient(apiKey: string): Anthropic {
  // dangerouslyAllowBrowser: esta app no tiene backend, la llamada sale
  // directo del navegador con la API key que el usuario pega localmente.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
}

/** Dibuja el fotograma actual del video en un canvas, reducido de tamaño para gastar menos. */
export function drawFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): boolean {
  if (video.videoWidth === 0) return false
  const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth)
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return true
}

function canvasToJpegBase64(canvas: HTMLCanvasElement): string {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}

/** Describe en una frase corta lo que se ve en el fotograma, usando visión de Claude. */
export async function captionFrame(client: Anthropic, canvas: HTMLCanvasElement): Promise<string> {
  const base64 = canvasToJpegBase64(canvas)
  const response = await client.messages.create({
    model: MODEL_ID,
    max_tokens: 100,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
          {
            type: 'text',
            text: 'Describe en una sola frase corta y natural, en español, qué está pasando en esta escena de video.',
          },
        ],
      },
    ],
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  return textBlock?.text.trim() ?? ''
}

export function describeCaptionError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'La API key no es válida. Revísala en console.anthropic.com.'
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Se alcanzó el límite de uso de la API. Intenta de nuevo en un momento.'
  }
  if (err instanceof Anthropic.APIError) {
    return `Error de la API (${err.status}): ${err.message}`
  }
  return err instanceof Error ? err.message : 'Error desconocido al describir el video.'
}
