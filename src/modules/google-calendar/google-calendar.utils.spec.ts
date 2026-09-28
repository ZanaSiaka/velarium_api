import {
    decryptGoogleToken,
    encryptGoogleToken,
} from './google-calendar.crypto';
import { mapGoogleEvent } from './google-calendar.mapper';

describe('Google Calendar mapping and encryption', () => {
    it('keeps all-day event dates separate from timed values', () => {
        const mapped = mapGoogleEvent(
            {
                id: 'all-day-event',
                start: { date: '2026-09-30' },
                end: { date: '2026-10-01' },
            },
            'connection-id',
            'primary',
        );

        expect(mapped.isAllDay).toBe(true);
        expect(mapped.startAt).toBeNull();
        expect(mapped.endAt).toBeNull();
        expect(mapped.startDate).toEqual(new Date('2026-09-30T00:00:00.000Z'));
        expect(mapped.endDate).toEqual(new Date('2026-10-01T00:00:00.000Z'));
    });

    it('maps timed event values without assigning date-only fields', () => {
        const mapped = mapGoogleEvent(
            {
                id: 'timed-event',
                start: { dateTime: '2026-09-30T09:30:00+02:00' },
                end: { dateTime: '2026-09-30T10:30:00+02:00' },
            },
            'connection-id',
            'primary',
        );

        expect(mapped.isAllDay).toBe(false);
        expect(mapped.startAt).toEqual(new Date('2026-09-30T07:30:00.000Z'));
        expect(mapped.endAt).toEqual(new Date('2026-09-30T08:30:00.000Z'));
        expect(mapped.startDate).toBeNull();
        expect(mapped.endDate).toBeNull();
    });

    it('encrypts refresh tokens so the stored value can be authenticated and decrypted', () => {
        const previousKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
        process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = 'ab'.repeat(32);

        try {
            const token = 'google-refresh-token';
            const encrypted = encryptGoogleToken(token);

            expect(encrypted).not.toContain(token);
            expect(decryptGoogleToken(encrypted)).toBe(token);
            expect(() => decryptGoogleToken(`${encrypted}tampered`)).toThrow();
        } finally {
            if (previousKey === undefined) {
                delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
            } else {
                process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = previousKey;
            }
        }
    });
});
