import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { InternalServerErrorException } from '@nestjs/common';

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
    const key = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    if (!key || !/^[\da-fA-F]{64}$/.test(key)) {
        throw new InternalServerErrorException(
            'GOOGLE_TOKEN_ENCRYPTION_KEY must contain 64 hexadecimal characters.',
        );
    }
    return Buffer.from(key, 'hex');
}

export function encryptGoogleToken(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
    const ciphertext = Buffer.concat([
        cipher.update(value, 'utf8'),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [iv, authTag, ciphertext]
        .map((part) => part.toString('base64url'))
        .join('.');
}

export function decryptGoogleToken(value: string): string {
    const [encodedIv, encodedTag, encodedCiphertext, ...extra] = value.split('.');
    if (!encodedIv || !encodedTag || !encodedCiphertext || extra.length > 0) {
        throw new InternalServerErrorException('Stored Google token is invalid.');
    }

    try {
        const decipher = createDecipheriv(
            ALGORITHM,
            getEncryptionKey(),
            Buffer.from(encodedIv, 'base64url'),
        );
        decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
        return Buffer.concat([
            decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
            decipher.final(),
        ]).toString('utf8');
    } catch {
        throw new InternalServerErrorException(
            'The stored Google token could not be decrypted.',
        );
    }
}
