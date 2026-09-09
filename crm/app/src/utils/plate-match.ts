/** Deja solo letras/dígitos en mayúscula, para comparar patentes sin importar espacios, puntos o guiones. */
function cleanPlate(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/**
 * Busca, dentro del texto crudo que devolvió el OCR, cuál patente conocida
 * (de la flota) es la más parecida. Primero intenta que la patente limpia
 * aparezca literal dentro del texto; si no, prueba token por token con
 * tolerancia de 1 carácter de diferencia (fotos borrosas, reflejos, etc).
 */
export function matchPlate(ocrText: string, knownPlates: string[]): string | null {
  const cleanedOcr = cleanPlate(ocrText);
  if (!cleanedOcr) return null;

  for (const plate of knownPlates) {
    const cleanedPlate = cleanPlate(plate);
    if (cleanedPlate.length >= 5 && cleanedOcr.includes(cleanedPlate)) return plate;
  }

  const tokens = ocrText.toUpperCase().match(/[A-Z0-9]{5,8}/g) || [];
  let best: { plate: string; dist: number } | null = null;
  for (const token of tokens) {
    const cleanedToken = cleanPlate(token);
    for (const plate of knownPlates) {
      const cleanedPlate = cleanPlate(plate);
      if (!cleanedPlate || Math.abs(cleanedPlate.length - cleanedToken.length) > 1) continue;
      const dist = levenshtein(cleanedToken, cleanedPlate);
      if (dist <= 1 && (!best || dist < best.dist)) best = { plate, dist };
    }
  }
  return best?.plate ?? null;
}
