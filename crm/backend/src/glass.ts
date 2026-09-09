/**
 * Catálogo del módulo "Vidrios" — un dominio de reparación separado del
 * técnico (disco duro, DVR, etc.), con sus propias categorías. Los casos
 * de vidrios se guardan localmente (ver types.ts DbShape.glassCases) pero
 * comparten la misma flota real (ver intranet.ts fetchFlota / isValidPpu).
 */
export const GLASS_CATEGORIAS: { value: string; label: string }[] = [
  { value: 'vidrio_lateral', label: 'Vidrio lateral' },
  { value: 'parabrisas', label: 'Parabrisas' },
  { value: 'vidrio_puertas', label: 'Vidrio de puertas' },
  { value: 'otro', label: 'Otro' },
];

export const GLASS_CATEGORIA_LABELS: Record<string, string> = Object.fromEntries(
  GLASS_CATEGORIAS.map((c) => [c.value, c.label]),
);

export const GLASS_RESOLUTION_ACTIONS: { value: string; label: string }[] = [
  { value: 'vidrio_reemplazado', label: 'Vidrio reemplazado' },
  { value: 'vidrio_reparado', label: 'Vidrio reparado/sellado' },
  { value: 'otro', label: 'Otro' },
];
