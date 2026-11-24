import { parsePhoneNumberFromString, CountryCode } from 'libphonenumber-js/max';

/**
 * Normaliza um telefone para E.164 (ex.: "(11) 91234-5678" -> "+5511912345678").
 * Retorna null se o número não for válido. É a chave de deduplicação do sistema.
 */
export function normalizePhone(raw: string, defaultRegion: string = 'BR'): string | null {
  const parsed = parsePhoneNumberFromString(raw.trim(), defaultRegion as CountryCode);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number; // E.164
}
