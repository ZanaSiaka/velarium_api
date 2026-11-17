import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

type FinanceUploadClaim = {
  userId: string; mouvementId: string; storageKey: string; nom: string; type: string; taille: number; expires: number;
};

// Domain-separated confirmation, using the same signed-upload pattern as D2.
function mac(payload: string) {
  if (!process.env.JWT_SECRET) throw new ServiceUnavailableException('Confirmation d’upload indisponible.');
  return createHmac('sha256', process.env.JWT_SECRET).update('finance-upload-v1.' + payload).digest();
}
export function signFinanceUpload(claim: FinanceUploadClaim) {
  const payload = Buffer.from(JSON.stringify(claim)).toString('base64url');
  return payload + '.' + mac(payload).toString('base64url');
}
export function verifyFinanceUpload(token: string | undefined, expected: Omit<FinanceUploadClaim, 'expires'>) {
  if (!token || token.length > 8192) throw new BadRequestException('Confirmation d’upload requise.');
  let claim: FinanceUploadClaim;
  try {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined) throw new Error();
    const received = Buffer.from(signature, 'base64url'), signatureExpected = mac(payload);
    if (received.length !== signatureExpected.length || !timingSafeEqual(received, signatureExpected)) throw new Error();
    claim = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!Number.isSafeInteger(claim.expires) || claim.expires <= Date.now()) throw new Error();
  } catch (error) {
    if (error instanceof ServiceUnavailableException) throw error;
    throw new BadRequestException('Confirmation d’upload invalide ou expirée.');
  }
  if (Object.entries(expected).some(([key, value]) => claim[key as keyof FinanceUploadClaim] !== value)) {
    throw new ForbiddenException('Confirmation ne correspondant pas à cet utilisateur, fichier ou mouvement.');
  }
}

export function validateFinanceStorageKey(key: string, mouvementId: string) {
  const prefix = 'finance/mouvements/' + mouvementId + '/';
  const leaf = key.startsWith(prefix) ? key.slice(prefix.length) : '';
  if (!leaf || leaf === '.' || leaf === '..' || /[/\\\u0000-\u001f\u007f]/.test(leaf)) {
    throw new ForbiddenException('Fichier hors du mouvement financier autorisé.');
  }
}
