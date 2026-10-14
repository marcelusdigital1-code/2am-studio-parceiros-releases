/**
 * Sanitiza códigos de verificação 2FA, TOTP e e-mail:
 * - Remove caracteres invisíveis Unicode (zero-width spaces, BOM, RTL/LTR marks)
 * - Remove prefixo "G-" ou "g-" comum em SMS/e-mails do Google
 * - Remove espaços e hífens entre dígitos para códigos puramente numéricos (ex: "86 28 81 55 13" -> "8628815513")
 * - Preserva códigos alfanuméricos de e-mail
 */
export function sanitizeCode(raw: string | null | undefined): string {
  if (!raw) return '';

  // 1. Remove caracteres invisíveis do clipboard / unicode
  let clean = raw.replace(/[\u200B-\u200D\uFEFF\u00A0\u200E\u200F\u0000-\u001F]/g, '').trim();

  // Se for o comando especial de aprovação mobile, não alterar
  if (clean === 'MOBILE_APPROVED') return clean;

  // 2. Remove prefixos comuns como "G-" ou "g-"
  clean = clean.replace(/^[Gg]-/i, '').trim();

  // 3. Se for puramente numérico com espaços ou traços, limpa todos os espaços e traços
  if (/^[0-9\s-]+$/.test(clean)) {
    clean = clean.replace(/[\s-]+/g, '');
  } else {
    // Alfanumérico (letras e números para códigos de verificação de e-mail)
    clean = clean.replace(/\s+/g, '');
  }

  return clean;
}
