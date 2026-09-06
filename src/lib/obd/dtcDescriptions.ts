// Diccionario de descripciones para los códigos de diagnóstico (DTC) genéricos
// (SAE) más comunes. Los códigos no listados reciben una descripción genérica
// según su categoría y rango, siguiendo la convención SAE J2012.

const KNOWN_CODES: Record<string, string> = {
  // --- Combustible y aire (P00xx-P02xx) ---
  P0100: 'Circuito del sensor de flujo de masa de aire (MAF) - mal funcionamiento',
  P0101: 'Sensor de flujo de masa de aire (MAF) - rango/rendimiento',
  P0102: 'Sensor de flujo de masa de aire (MAF) - entrada baja',
  P0103: 'Sensor de flujo de masa de aire (MAF) - entrada alta',
  P0106: 'Sensor de presión absoluta del múltiple (MAP) - rango/rendimiento',
  P0107: 'Sensor de presión absoluta del múltiple (MAP) - entrada baja',
  P0108: 'Sensor de presión absoluta del múltiple (MAP) - entrada alta',
  P0110: 'Circuito del sensor de temperatura de aire de admisión - mal funcionamiento',
  P0113: 'Sensor de temperatura de aire de admisión - entrada alta',
  P0115: 'Circuito del sensor de temperatura del refrigerante - mal funcionamiento',
  P0116: 'Sensor de temperatura del refrigerante - rango/rendimiento',
  P0117: 'Sensor de temperatura del refrigerante - entrada baja',
  P0118: 'Sensor de temperatura del refrigerante - entrada alta',
  P0120: 'Circuito del sensor de posición del acelerador (TPS) - mal funcionamiento',
  P0121: 'Sensor de posición del acelerador - rango/rendimiento',
  P0122: 'Sensor de posición del acelerador - entrada baja',
  P0123: 'Sensor de posición del acelerador - entrada alta',
  P0125: 'Temperatura del refrigerante insuficiente para el control de combustible',
  P0128: 'Termostato - la temperatura del refrigerante no alcanza el valor esperado',
  P0130: 'Circuito del sensor de oxígeno (banco 1, sensor 1) - mal funcionamiento',
  P0131: 'Sensor de oxígeno (banco 1, sensor 1) - voltaje bajo',
  P0132: 'Sensor de oxígeno (banco 1, sensor 1) - voltaje alto',
  P0133: 'Sensor de oxígeno (banco 1, sensor 1) - respuesta lenta',
  P0134: 'Sensor de oxígeno (banco 1, sensor 1) - sin actividad detectada',
  P0135: 'Calefacción del sensor de oxígeno (banco 1, sensor 1) - mal funcionamiento',
  P0136: 'Circuito del sensor de oxígeno (banco 1, sensor 2) - mal funcionamiento',
  P0140: 'Sensor de oxígeno (banco 1, sensor 2) - sin actividad detectada',
  P0141: 'Calefacción del sensor de oxígeno (banco 1, sensor 2) - mal funcionamiento',
  P0150: 'Circuito del sensor de oxígeno (banco 2, sensor 1) - mal funcionamiento',
  P0155: 'Calefacción del sensor de oxígeno (banco 2, sensor 1) - mal funcionamiento',
  P0160: 'Circuito del sensor de oxígeno (banco 2, sensor 2) - sin actividad detectada',
  P0171: 'Sistema demasiado pobre (banco 1)',
  P0172: 'Sistema demasiado rico (banco 1)',
  P0174: 'Sistema demasiado pobre (banco 2)',
  P0175: 'Sistema demasiado rico (banco 2)',
  P0180: 'Circuito del sensor de temperatura de combustible - mal funcionamiento',
  P0190: 'Circuito del sensor de presión del riel de combustible - mal funcionamiento',

  // --- Cilindros, encendido, misfire (P02xx-P03xx) ---
  P0200: 'Circuito del inyector - mal funcionamiento',
  P0201: 'Circuito del inyector - cilindro 1',
  P0202: 'Circuito del inyector - cilindro 2',
  P0203: 'Circuito del inyector - cilindro 3',
  P0204: 'Circuito del inyector - cilindro 4',
  P0217: 'Sobretemperatura del motor (recalentamiento)',
  P0230: 'Circuito primario de la bomba de combustible - mal funcionamiento',
  P0300: 'Fallo de encendido (misfire) aleatorio/múltiples cilindros detectado',
  P0301: 'Fallo de encendido (misfire) detectado - cilindro 1',
  P0302: 'Fallo de encendido (misfire) detectado - cilindro 2',
  P0303: 'Fallo de encendido (misfire) detectado - cilindro 3',
  P0304: 'Fallo de encendido (misfire) detectado - cilindro 4',
  P0305: 'Fallo de encendido (misfire) detectado - cilindro 5',
  P0306: 'Fallo de encendido (misfire) detectado - cilindro 6',
  P0325: 'Circuito del sensor de golpeteo (knock sensor) - mal funcionamiento',
  P0327: 'Sensor de golpeteo (banco 1) - señal baja',
  P0330: 'Circuito del sensor de golpeteo (banco 2) - mal funcionamiento',
  P0335: 'Circuito del sensor de posición del cigüeñal - mal funcionamiento',
  P0336: 'Sensor de posición del cigüeñal - rango/rendimiento',
  P0340: 'Circuito del sensor de posición del árbol de levas - mal funcionamiento',
  P0341: 'Sensor de posición del árbol de levas - rango/rendimiento',
  P0350: 'Circuito primario/secundario de la bobina de encendido - mal funcionamiento',
  P0351: 'Circuito de la bobina de encendido A - mal funcionamiento',

  // --- Sistema de control de emisiones (P04xx) ---
  P0400: 'Flujo del sistema de recirculación de gases de escape (EGR) - mal funcionamiento',
  P0401: 'Flujo insuficiente del sistema EGR',
  P0402: 'Flujo excesivo del sistema EGR',
  P0410: 'Sistema de aire secundario - mal funcionamiento',
  P0420: 'Eficiencia del catalizador por debajo del umbral (banco 1)',
  P0421: 'Rendimiento del catalizador de calentamiento rápido (banco 1)',
  P0430: 'Eficiencia del catalizador por debajo del umbral (banco 2)',
  P0440: 'Sistema de control de emisiones evaporativas (EVAP) - mal funcionamiento',
  P0441: 'Flujo de purga incorrecto en el sistema EVAP',
  P0442: 'Fuga pequeña detectada en el sistema EVAP',
  P0443: 'Circuito de la válvula de purga EVAP - mal funcionamiento',
  P0446: 'Circuito de control de ventilación del sistema EVAP - mal funcionamiento',
  P0455: 'Fuga grande detectada en el sistema EVAP',
  P0456: 'Fuga muy pequeña detectada en el sistema EVAP',

  // --- Velocidad del vehículo, ralentí, entradas/salidas auxiliares (P05xx) ---
  P0500: 'Sensor de velocidad del vehículo - mal funcionamiento',
  P0501: 'Sensor de velocidad del vehículo - rango/rendimiento',
  P0505: 'Sistema de control de ralentí - mal funcionamiento',
  P0506: 'Sistema de control de ralentí - RPM más bajas de lo esperado',
  P0507: 'Sistema de control de ralentí - RPM más altas de lo esperado',
  P0560: 'Voltaje del sistema fuera de rango',
  P0562: 'Voltaje del sistema bajo',
  P0563: 'Voltaje del sistema alto',

  // --- Transmisión (P07xx-P08xx) ---
  P0700: 'Solicitud de código de falla del sistema de control de la transmisión',
  P0705: 'Circuito del sensor de posición de la palanca de cambios - mal funcionamiento',
  P0715: 'Circuito del sensor de velocidad de entrada de la transmisión - mal funcionamiento',
  P0720: 'Circuito del sensor de velocidad de salida de la transmisión - mal funcionamiento',
  P0730: 'Relación de cambio incorrecta',
  P0740: 'Circuito del embrague del convertidor de par - mal funcionamiento',
  P0750: 'Circuito de la válvula solenoide de cambio A - mal funcionamiento',

  // --- Genéricos comunes de Chasis / Carrocería / Red ---
  C0035: 'Circuito del sensor de velocidad de rueda delantera derecha',
  C0040: 'Circuito del sensor de velocidad de rueda delantera izquierda',
  C0045: 'Circuito del sensor de velocidad de rueda trasera derecha',
  C0050: 'Circuito del sensor de velocidad de rueda trasera izquierda',
  B0001: 'Circuito de despliegue de la bolsa de aire del conductor',
  B0051: 'Cinturón de seguridad del conductor - circuito del pretensionador',
  U0001: 'Bus de comunicación CAN de alta velocidad (bus de datos) - sin comunicación',
  U0100: 'Pérdida de comunicación con el módulo de control del motor (ECM/PCM)',
  U0101: 'Pérdida de comunicación con el módulo de control de la transmisión (TCM)',
  U0121: 'Pérdida de comunicación con el módulo de control del ABS',
}

const CATEGORY_LABELS: Record<string, string> = {
  P: 'Motor / Tren motriz',
  C: 'Chasis',
  B: 'Carrocería',
  U: 'Red de comunicación (bus)',
}

function isGenericCode(code: string): boolean {
  // Los códigos genéricos SAE tienen 0 o 2/3 como segundo dígito según la letra;
  // en la práctica basta con distinguir P0/P2/P3 (genéricos) de P1 (fabricante).
  const secondDigit = code[1]
  return secondDigit === '0' || secondDigit === '2' || secondDigit === '3'
}

export function describeDtc(code: string): string {
  const known = KNOWN_CODES[code]
  if (known) return known

  const letter = code[0]
  const category = CATEGORY_LABELS[letter] ?? 'Genérico'
  const generic = isGenericCode(code)
  const origin = generic ? 'código genérico SAE' : 'código específico del fabricante'
  return `Falla en el sistema de ${category} (${origin}) — sin descripción detallada disponible localmente.`
}
