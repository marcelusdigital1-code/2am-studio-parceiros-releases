// ── ENCRIPTAÇÃO DE CREDENCIAIS (AES-256-GCM) ──────────────────────────
// Utiliza a Web Crypto API nativa do navegador e do Node 18+
// 100% compatível com a função decryptCred() em agent-windows/electron/main.ts

const _CK = [
  0x50, 0x52, 0x4f, 0x4a, 0x5f, 0x50, 0x41, 0x52, 0x43, 0x5f, 0x56, 0x41, 0x55, 0x4c, 0x54, 0x5f,
  0x41, 0x47, 0x45, 0x4e, 0x54, 0x5f, 0x32, 0x30, 0x32, 0x36, 0x5f, 0x53, 0x45, 0x43, 0x55, 0x52,
  0x45,
];

let cachedKey: CryptoKey | null = null;

async function getCryptoKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const keyBytes = new Uint8Array(_CK);
  const keyDigest = await crypto.subtle.digest('SHA-256', keyBytes);
  cachedKey = await crypto.subtle.importKey(
    'raw',
    keyDigest,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
  return cachedKey;
}

/**
 * Encripta uma credencial com AES-256-GCM e retorna com o prefixo 'AGY1:' em Base64.
 * Se já estiver encriptada ou vazia, retorna sem alterações.
 */
export async function encryptCred(plaintext: string): Promise<string> {
  if (!plaintext || typeof plaintext !== 'string' || plaintext.startsWith('AGY1:')) return plaintext;
  try {
    const key = await getCryptoKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const ctAndTag = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(plaintext)
    );

    const combined = new Uint8Array(iv.length + ctAndTag.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ctAndTag), iv.length);

    let binary = '';
    const len = combined.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(combined[i]);
    }
    const b64 = btoa(binary);
    return `AGY1:${b64}`;
  } catch (err) {
    console.error('[CRYPTO] Falha ao encriptar credencial:', err);
    return plaintext;
  }
}

/**
 * Desencripta uma credencial encriptada com AES-256-GCM.
 * Se não tiver o prefixo 'AGY1:', devolve o valor original (texto legado).
 */
export async function decryptCred(encryptedValue: string): Promise<string> {
  if (!encryptedValue || typeof encryptedValue !== 'string' || !encryptedValue.startsWith('AGY1:')) return encryptedValue;
  try {
    const key = await getCryptoKey();
    const b64 = encryptedValue.slice(5);
    const binary = atob(b64);
    const raw = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      raw[i] = binary.charCodeAt(i);
    }

    if (raw.length < 28) return encryptedValue;

    const iv = raw.subarray(0, 12);
    const data = raw.subarray(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );

    const dec = new TextDecoder();
    return dec.decode(decrypted);
  } catch (err) {
    console.error('[CRYPTO] Falha ao desencriptar credencial:', err);
    return encryptedValue;
  }
}
