import { ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';

// A keyed fingerprint, never the bcrypt hash itself, binds the JWT to the
// current credentials without adding a column to the live database.
export function credentialTag(user: { id: string; passwordHash: string }) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new ServiceUnavailableException('Authentification momentanément indisponible.');
  return createHmac('sha256', secret).update(JSON.stringify(['auth-credentials-v1', user.id, user.passwordHash])).digest('hex');
}
export function validCredentialTag(tag: unknown, user: { id: string; passwordHash: string }) {
  if (typeof tag !== 'string' || !/^[a-f0-9]{64}$/.test(tag)) return false;
  return timingSafeEqual(Buffer.from(tag, 'hex'), Buffer.from(credentialTag(user), 'hex'));
}
// Distinct representation in the existing token column: legacy plaintext
// tokens are preserved, but never accepted by this lookup.
export function resetTokenFingerprint(token: string) {
  return 'sha256:' + createHash('sha256').update('password-reset-v1.' + token).digest('hex');
}
