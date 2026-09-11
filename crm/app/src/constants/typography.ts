/**
 * Familia tipográfica de la app (Plus Jakarta Sans) — reemplaza la fuente
 * del sistema para que la interfaz no se vea genérica. Cada peso es una
 * familia de fuente distinta (así funcionan las fuentes de Google Fonts
 * en React Native): usar `fontFamily` en vez de `fontWeight` en los
 * estilos que adoptan esta tipografía.
 */
export const fontFamily = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;
