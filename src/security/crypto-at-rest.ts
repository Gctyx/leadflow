import crypto from 'node:crypto';

// AES-256-GCM encryption for secrets at rest (e.g., TOTP secrets)
export function encryptAtRest(hexKey: string, plaintext: Buffer) {
  const key = Buffer.from(hexKey, 'hex');
  if (key.length < 32) throw new Error('ADMIN_AT_REST_KEY must be >=32 bytes');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key.slice(0, 32), iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { enc, iv, tag };
}

export function decryptAtRest(hexKey: string, enc: Buffer, iv: Buffer, tag: Buffer) {
  const key = Buffer.from(hexKey, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key.slice(0, 32), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec;
}
