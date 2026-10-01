import {
    BadGatewayException,
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import {
    GoogleCalendarConnection,
    GoogleCalendarEvent,
    Prisma,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { google, calendar_v3 } from 'googleapis';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { GoogleCalendarEventWriteDto } from './dto/google-calendar-event-write.dto';
import { GoogleCalendarEventsQueryDto } from './dto/google-calendar-events-query.dto';
import { GoogleCalendarStatusDto } from './dto/google-calendar-status.dto';
import {
    GoogleCalendarOAuthState,
    GoogleCalendarSyncResult,
} from './google-calendar.types';
import {
    decryptGoogleToken,
    encryptGoogleToken,
} from './google-calendar.crypto';
import { mapGoogleEvent } from './google-calendar.mapper';

const GOOGLE_SCOPES = [
    'openid',
    'email',
    'https://www.googleapis.com/auth/calendar.events',
];
const GOOGLE_WRITE_SCOPES = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar',
];
const GOOGLE_PAGE_SIZE = 250;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

type SyncCounts = { created: number; updated: number; deleted: number };
type GoogleApiError = {
    code?: string;
    message?: string;
    response?: { status?: number; data?: { error?: string } };
};

function isOAuthState(value: unknown): value is GoogleCalendarOAuthState {
    if (!value || typeof value !== 'object') return false;
    const claims = value as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);
    return (
        typeof claims.sub === 'string' &&
        claims.sub.length > 0 &&
        typeof claims.nonce === 'string' &&
        claims.nonce.length > 0 &&
        typeof claims.iat === 'number' &&
        typeof claims.exp === 'number' &&
        claims.exp > now &&
        claims.exp - claims.iat <= OAUTH_STATE_TTL_SECONDS &&
        claims.iat <= now + 30
    );
}

@Injectable()
export class GoogleCalendarService {
    private readonly activeSyncs = new Map<
        string,
        Promise<GoogleCalendarSyncResult>
    >();

    constructor(private readonly prisma: PrismaService) { }

    async getConnectUrl(userId: string): Promise<{ url: string }> {
        await this.requireActiveUser(userId);
        const state = this.createState(userId);
        const oauth = this.createOAuthClient();
        return {
            url: oauth.generateAuthUrl({
                access_type: 'offline',
                prompt: 'consent',
                include_granted_scopes: true,
                scope: GOOGLE_SCOPES,
                state,
            }),
        };
    }

    async handleCallback(code?: string, state?: string): Promise<void> {
        if (!code || !state) {
            throw new BadRequestException('Google OAuth callback is incomplete.');
        }

        const { sub: userId } = this.verifyState(state);
        await this.requireActiveUser(userId);

        const oauth = this.createOAuthClient();
        const { tokens } = await oauth.getToken(code);
        oauth.setCredentials(tokens);

        if (!tokens.id_token) {
            throw new BadRequestException(
                'Google did not return a valid OpenID token.',
            );
        }
        const ticket = await oauth.verifyIdToken({
            idToken: tokens.id_token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const profile = ticket.getPayload();
        if (!profile?.sub || !profile.email) {
            throw new BadRequestException('Google account identity is unavailable.');
        }
        const googleAccountId = profile.sub;
        const googleEmail = profile.email;
        const previous = await this.prisma.googleCalendarConnection.findUnique({
            where: { userId },
        });

        let refreshToken = tokens.refresh_token;
        if (!refreshToken && previous) {
            const sameAccount = previous.googleAccountId
                ? previous.googleAccountId === googleAccountId
                : Boolean(previous.googleEmail && previous.googleEmail === googleEmail);
            if (sameAccount) {
                refreshToken = decryptGoogleToken(previous.refreshTokenEncrypted);
            }
        }
        if (!refreshToken) {
            throw new BadRequestException(
                'Google did not provide a reusable refresh token. Revoke Velarium access in Google and try again.',
            );
        }

        const refreshTokenEncrypted = encryptGoogleToken(refreshToken);
        const connection = await this.prisma.$transaction(async (tx) => {
            if (previous) {
                await tx.googleCalendarEvent.deleteMany({
                    where: { connectionId: previous.id },
                });
            }

            return tx.googleCalendarConnection.upsert({
                where: { userId },
                update: {
                    googleAccountId,
                    googleEmail,
                    calendarId: 'primary',
                    refreshTokenEncrypted,
                    scope: tokens.scope ?? GOOGLE_SCOPES.join(' '),
                    syncToken: null,
                    status: 'CONNECTED',
                    lastSyncAt: null,
                    lastFullSyncAt: null,
                    lastSyncError: null,
                },
                create: {
                    userId,
                    googleAccountId,
                    googleEmail,
                    calendarId: 'primary',
                    refreshTokenEncrypted,
                    scope: tokens.scope ?? GOOGLE_SCOPES.join(' '),
                },
            });
        });

        try {
            await this.syncConnection(connection);
        } catch {
            // Tokens already saved; sync can be retried from the UI.
        }
    }

    async getStatus(userId: string): Promise<GoogleCalendarStatusDto> {
        const connection = await this.prisma.googleCalendarConnection.findUnique({
            where: { userId },
            select: {
                status: true,
                googleEmail: true,
                calendarId: true,
                lastSyncAt: true,
                lastFullSyncAt: true,
            },
        });

        if (!connection) return { connected: false };
        return { connected: true, ...connection };
    }

    async getEvents(userId: string, query: GoogleCalendarEventsQueryDto) {
        const connection = await this.prisma.googleCalendarConnection.findUnique({
            where: { userId },
            select: { id: true },
        });
        if (!connection) {
            throw new ConflictException('Google Calendar is not connected.');
        }

        if (query.from && query.to && query.from > query.to) {
            throw new BadRequestException(
                'The from date must be before or equal to to.',
            );
        }

        const from = query.from
            ? new Date(`${query.from}T00:00:00.000Z`)
            : undefined;
        const toExclusive = query.to
            ? new Date(`${this.addDays(query.to, 1)}T00:00:00.000Z`)
            : undefined;
        const offset = (query.page - 1) * query.limit;
        const conditions: Prisma.Sql[] = [
            Prisma.sql`"connectionId" = ${connection.id}`,
            Prisma.sql`"status" IS DISTINCT FROM 'cancelled'`,
        ];
        if (from) {
            conditions.push(Prisma.sql`(
        COALESCE("endAt", "endDate"::timestamp) > ${from}
        OR (
          COALESCE("endAt", "endDate"::timestamp) IS NULL
          AND COALESCE("startAt", "startDate"::timestamp) >= ${from}
        )
      )`);
        }
        if (toExclusive) {
            conditions.push(
                Prisma.sql`COALESCE("startAt", "startDate"::timestamp) < ${toExclusive}`,
            );
        }
        const whereSql = Prisma.join(conditions, ' AND ');
        const [items, countRows] = await Promise.all([
            this.prisma.$queryRaw<GoogleCalendarEvent[]>(Prisma.sql`
        SELECT * FROM "GoogleCalendarEvent"
        WHERE ${whereSql}
        ORDER BY COALESCE("startAt", "startDate"::timestamp) ASC NULLS LAST,
          "googleEventId" ASC
        LIMIT ${query.limit} OFFSET ${offset}
      `),
            this.prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`
        SELECT COUNT(*) AS total
        FROM "GoogleCalendarEvent"
        WHERE ${whereSql}
      `),
        ]);
        const total = Number(countRows[0]?.total ?? 0);

        return {
            items,
            pagination: {
                page: query.page,
                limit: query.limit,
                total,
                pages: Math.ceil(total / query.limit),
            },
        };
    }

    async createEvent(userId: string, dto: GoogleCalendarEventWriteDto) {
        const connection = await this.requireWritableConnection(userId);
        const { api } = await this.getAuthenticatedClient(connection);
        try {
            const response = await api.events.insert({
                calendarId: connection.calendarId || 'primary',
                requestBody: this.toGoogleEventResource(dto),
            });
            if (!response.data?.id) {
                throw new BadGatewayException(
                    'Google Calendar n’a pas renvoyé l’événement créé.',
                );
            }
            return this.persistGoogleEvent(connection, response.data);
        } catch (error) {
            if (
                error instanceof BadGatewayException ||
                error instanceof BadRequestException
            ) {
                throw error;
            }
            return this.handleSyncError(connection.id, error);
        }
    }

    async updateEvent(
        userId: string,
        googleEventId: string,
        dto: GoogleCalendarEventWriteDto,
    ) {
        const connection = await this.requireWritableConnection(userId);
        const { api } = await this.getAuthenticatedClient(connection);
        try {
            const response = await api.events.update({
                calendarId: connection.calendarId,
                eventId: decodeURIComponent(googleEventId),
                requestBody: this.toGoogleEventResource(dto),
            });
            if (!response.data?.id) {
                throw new BadGatewayException(
                    'Google Calendar n’a pas renvoyé l’événement mis à jour.',
                );
            }
            return this.persistGoogleEvent(connection, response.data);
        } catch (error) {
            if (
                error instanceof BadGatewayException ||
                error instanceof BadRequestException
            ) {
                throw error;
            }
            return this.handleSyncError(connection.id, error);
        }
    }

    async deleteEvent(userId: string, googleEventId: string) {
        const connection = await this.requireWritableConnection(userId);
        const { api } = await this.getAuthenticatedClient(connection);
        const eventId = decodeURIComponent(googleEventId);
        try {
            await api.events.delete({
                calendarId: connection.calendarId,
                eventId,
            });
        } catch (error) {
            const status = this.getGoogleError(error).response?.status;
            if (status !== 404 && status !== 410) {
                return this.handleSyncError(connection.id, error);
            }
        }

        await this.prisma.googleCalendarEvent.deleteMany({
            where: {
                connectionId: connection.id,
                googleEventId: eventId,
            },
        });
        return { success: true as const };
    }

    async syncForUser(userId: string): Promise<GoogleCalendarSyncResult> {
        const connection = await this.prisma.googleCalendarConnection.findUnique({
            where: { userId },
        });
        if (!connection) {
            throw new ConflictException('Google Calendar is not connected.');
        }

        const current = this.activeSyncs.get(connection.id);
        if (current) return current;

        const sync = this.syncConnection(connection);
        this.activeSyncs.set(connection.id, sync);
        try {
            return await sync;
        } finally {
            if (this.activeSyncs.get(connection.id) === sync) {
                this.activeSyncs.delete(connection.id);
            }
        }
    }

    async disconnect(
        userId: string,
    ): Promise<{ success: true; connected: false }> {
        const connection = await this.prisma.googleCalendarConnection.findUnique({
            where: { userId },
        });
        if (!connection) return { success: true, connected: false };

        await this.activeSyncs.get(connection.id)?.catch(() => undefined);
        try {
            const refreshToken = decryptGoogleToken(connection.refreshTokenEncrypted);
            const oauth = this.createOAuthClient();
            await oauth.revokeToken(refreshToken);
        } catch {
            await this.prisma.googleCalendarConnection.deleteMany({
                where: { userId },
            });
            return { success: true, connected: false };
        }

        await this.prisma.googleCalendarConnection.deleteMany({
            where: { userId },
        });
        return { success: true, connected: false };
    }

    private async syncConnection(
        connection: GoogleCalendarConnection,
    ): Promise<GoogleCalendarSyncResult> {
        try {
            return connection.syncToken
                ? await this.incrementalSync(connection)
                : await this.fullSync(connection);
        } catch (error) {
            if (
                this.getGoogleError(error).response?.status === 410 &&
                connection.syncToken
            ) {
                await this.prisma.googleCalendarEvent.deleteMany({
                    where: { connectionId: connection.id },
                });
                await this.prisma.googleCalendarConnection.update({
                    where: { id: connection.id },
                    data: { syncToken: null },
                });
                try {
                    return await this.fullSync({ ...connection, syncToken: null });
                } catch (fullSyncError) {
                    return this.handleSyncError(connection.id, fullSyncError);
                }
            }
            return this.handleSyncError(connection.id, error);
        }
    }

    private async fullSync(
        connection: GoogleCalendarConnection,
    ): Promise<GoogleCalendarSyncResult> {
        const { api } = await this.getAuthenticatedClient(connection);
        const counts: SyncCounts = { created: 0, updated: 0, deleted: 0 };
        let pageToken: string | undefined;
        let nextSyncToken: string | undefined;

        do {
            const response = await api.events.list({
                calendarId: connection.calendarId,
                maxResults: GOOGLE_PAGE_SIZE,
                pageToken,
                showDeleted: true,
                singleEvents: true,
            });
            await this.persistEvents(connection, response.data.items ?? [], counts);
            pageToken = response.data.nextPageToken ?? undefined;
            if (!pageToken) nextSyncToken = response.data.nextSyncToken ?? undefined;
        } while (pageToken);

        if (!nextSyncToken) {
            throw new Error('Google Calendar did not return a sync token.');
        }

        const syncedAt = new Date();
        await this.prisma.googleCalendarConnection.update({
            where: { id: connection.id },
            data: {
                syncToken: nextSyncToken,
                lastSyncAt: syncedAt,
                lastFullSyncAt: syncedAt,
                lastSyncError: null,
                status: 'CONNECTED',
            },
        });
        return { syncedAt, ...counts };
    }

    private async incrementalSync(
        connection: GoogleCalendarConnection,
    ): Promise<GoogleCalendarSyncResult> {
        if (!connection.syncToken) return this.fullSync(connection);
        const { api } = await this.getAuthenticatedClient(connection);
        const counts: SyncCounts = { created: 0, updated: 0, deleted: 0 };
        let pageToken: string | undefined;
        let nextSyncToken: string | undefined;

        do {
            const response = await api.events.list({
                calendarId: connection.calendarId,
                maxResults: GOOGLE_PAGE_SIZE,
                pageToken,
                showDeleted: true,
                singleEvents: true,
                syncToken: connection.syncToken,
            });
            await this.persistEvents(connection, response.data.items ?? [], counts);
            pageToken = response.data.nextPageToken ?? undefined;
            if (!pageToken) nextSyncToken = response.data.nextSyncToken ?? undefined;
        } while (pageToken);

        if (!nextSyncToken) {
            throw new Error('Google Calendar did not return a sync token.');
        }

        const syncedAt = new Date();
        await this.prisma.googleCalendarConnection.update({
            where: { id: connection.id },
            data: {
                syncToken: nextSyncToken,
                lastSyncAt: syncedAt,
                lastSyncError: null,
                status: 'CONNECTED',
            },
        });
        return { syncedAt, ...counts };
    }

    private async persistEvents(
        connection: GoogleCalendarConnection,
        events: calendar_v3.Schema$Event[],
        counts: SyncCounts,
    ): Promise<void> {
        for (let offset = 0; offset < events.length; offset += 20) {
            const batch = events.slice(offset, offset + 20);
            const results = await Promise.all(
                batch.map(async (event) => {
                    if (!event.id) return { created: 0, updated: 0, deleted: 0 };
                    if (event.status === 'cancelled') {
                        const result = await this.prisma.googleCalendarEvent.deleteMany({
                            where: {
                                connectionId: connection.id,
                                googleEventId: event.id,
                            },
                        });
                        return { created: 0, updated: 0, deleted: result.count };
                    }

                    const where = {
                        connectionId_googleEventId: {
                            connectionId: connection.id,
                            googleEventId: event.id,
                        },
                    };
                    const existing = await this.prisma.googleCalendarEvent.findUnique({
                        where,
                    });
                    const mapped = mapGoogleEvent(
                        event,
                        connection.id,
                        connection.calendarId,
                    );
                    await this.prisma.googleCalendarEvent.upsert({
                        where,
                        create: mapped,
                        update: mapped,
                    });
                    return existing
                        ? { created: 0, updated: 1, deleted: 0 }
                        : { created: 1, updated: 0, deleted: 0 };
                }),
            );
            for (const result of results) {
                counts.created += result.created;
                counts.updated += result.updated;
                counts.deleted += result.deleted;
            }
        }
    }

    private async getAuthenticatedClient(connection: GoogleCalendarConnection): Promise<{
        oauth: OAuth2Client;
        api: calendar_v3.Calendar;
    }> {
        const oauth = this.createOAuthClient();
        oauth.setCredentials({
            refresh_token: decryptGoogleToken(connection.refreshTokenEncrypted),
        });
        await oauth.getAccessToken();
        return { oauth, api: google.calendar({ version: 'v3', auth: oauth }) };
    }

    private createOAuthClient(): OAuth2Client {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        const redirectUri = process.env.GOOGLE_REDIRECT_URI;
        if (!clientId || !clientSecret || !redirectUri) {
            throw new BadRequestException(
                'Google Calendar OAuth environment variables are not configured.',
            );
        }
        return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    }

    private createState(userId: string): string {
        const now = Math.floor(Date.now() / 1000);
        const payload: GoogleCalendarOAuthState = {
            sub: userId,
            nonce: randomUUID(),
            iat: now,
            exp: now + OAUTH_STATE_TTL_SECONDS,
        };
        const header = this.encodeBase64Url(
            JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
        );
        const body = this.encodeBase64Url(JSON.stringify(payload));
        const unsigned = `${header}.${body}`;
        return `${unsigned}.${this.signState(unsigned)}`;
    }

    private verifyState(state: string): GoogleCalendarOAuthState {
        const parts = state.split('.');
        if (parts.length !== 3 || parts.some((part) => !part)) {
            throw new BadRequestException('Google OAuth state is invalid.');
        }
        const unsigned = `${parts[0]}.${parts[1]}`;
        const expected = Buffer.from(this.signState(unsigned));
        const actual = Buffer.from(parts[2]);
        if (
            expected.length !== actual.length ||
            !timingSafeEqual(expected, actual)
        ) {
            throw new BadRequestException('Google OAuth state is invalid.');
        }

        try {
            const header: unknown = JSON.parse(
                Buffer.from(parts[0], 'base64url').toString('utf8'),
            );
            const payload: unknown = JSON.parse(
                Buffer.from(parts[1], 'base64url').toString('utf8'),
            );
            if (
                !header ||
                typeof header !== 'object' ||
                !('alg' in header) ||
                header.alg !== 'HS256' ||
                !isOAuthState(payload)
            ) {
                throw new Error('Invalid OAuth state claims.');
            }
            return payload;
        } catch {
            throw new BadRequestException(
                'Google OAuth state is invalid or expired.',
            );
        }
    }

    private signState(value: string): string {
        const secret = process.env.GOOGLE_OAUTH_STATE_SECRET;
        if (!secret || secret.length < 32) {
            throw new BadRequestException(
                'GOOGLE_OAUTH_STATE_SECRET must contain at least 32 characters.',
            );
        }
        return createHmac('sha256', secret).update(value).digest('base64url');
    }

    private encodeBase64Url(value: string): string {
        return Buffer.from(value).toString('base64url');
    }

    private async requireActiveUser(userId: string): Promise<void> {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, active: true },
        });
        if (!user || !user.active) {
            throw new NotFoundException(
                'Utilisateur Velarium introuvable ou inactif.',
            );
        }
    }

    private async requireWritableConnection(userId: string) {
        const connection =
            await this.prisma.googleCalendarConnection.findUnique({
                where: { userId },
            });
        if (!connection) {
            throw new ConflictException(
                'Google Calendar n’est pas connecté.',
            );
        }
        this.assertWriteScope(connection);
        return connection;
    }

    private assertWriteScope(connection: GoogleCalendarConnection): void {
        const scopes = (connection.scope ?? '')
            .split(/[ ,]+/)
            .filter(Boolean);
        if (scopes.length === 0) return;
        const canWrite = scopes.some((scope) =>
            GOOGLE_WRITE_SCOPES.some(
                (allowed) =>
                    scope === allowed ||
                    scope.endsWith('/auth/calendar.events') ||
                    (scope.endsWith('/auth/calendar') &&
                        !scope.includes('readonly')),
            ),
        );
        if (!canWrite) {
            throw new ServiceUnavailableException({
                code: 'GOOGLE_RECONNECT_REQUIRED',
                message:
                    'La connexion Google Calendar doit être renouvelée pour créer ou modifier des événements.',
            });
        }
    }

    private toGoogleEventResource(
        dto: GoogleCalendarEventWriteDto,
    ): calendar_v3.Schema$Event {
        const timeZone =
            process.env.GOOGLE_CALENDAR_TIMEZONE ?? 'Europe/Paris';

        if (dto.allDay) {
            const startDate = dto.start.slice(0, 10);
            let endDate = dto.end ? dto.end.slice(0, 10) : this.addDays(startDate, 1);
            if (endDate <= startDate) {
                endDate = this.addDays(startDate, 1);
            }
            return {
                summary: dto.title,
                description: dto.description,
                location: dto.location,
                start: { date: startDate },
                end: { date: endDate },
            };
        }

        const start = new Date(dto.start);
        const end = dto.end
            ? new Date(dto.end)
            : new Date(start.getTime() + 30 * 60 * 1000);

        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            throw new BadRequestException(
                'Les dates de l’événement Google sont invalides.',
            );
        }

        return {
            summary: dto.title,
            description: dto.description,
            location: dto.location,
            start: {
                dateTime: start.toISOString(),
                timeZone,
            },
            end: {
                dateTime: end.toISOString(),
                timeZone,
            },
        };
    }

    private persistGoogleEvent(
        connection: GoogleCalendarConnection,
        event: calendar_v3.Schema$Event,
    ) {
        const mapped = mapGoogleEvent(
            event,
            connection.id,
            connection.calendarId,
        );
        return this.prisma.googleCalendarEvent.upsert({
            where: {
                connectionId_googleEventId: {
                    connectionId: connection.id,
                    googleEventId: mapped.googleEventId,
                },
            },
            create: mapped,
            update: mapped,
        });
    }

    private async handleSyncError(
        connectionId: string,
        error: unknown,
    ): Promise<never> {
        const googleError = this.getGoogleError(error);
        const invalidGrant =
            googleError.code === 'invalid_grant' ||
            googleError.response?.data?.error === 'invalid_grant' ||
            googleError.message?.includes('invalid_grant');
        await this.prisma.googleCalendarConnection.update({
            where: { id: connectionId },
            data: {
                status: 'ERROR',
                lastSyncError: invalidGrant
                    ? 'refresh_token_invalid'
                    : 'google_sync_failed',
            },
        });

        if (invalidGrant) {
            throw new ServiceUnavailableException({
                code: 'GOOGLE_RECONNECT_REQUIRED',
                message: 'La connexion Google Calendar doit être renouvelée.',
            });
        }
        throw new BadGatewayException(
            'La synchronisation Google Calendar a échoué.',
        );
    }

    private getGoogleError(error: unknown): GoogleApiError {
        if (!error || typeof error !== 'object') return {};
        const value = error as Record<string, unknown>;
        const response =
            value.response && typeof value.response === 'object'
                ? (value.response as Record<string, unknown>)
                : undefined;
        const data =
            response?.data && typeof response.data === 'object'
                ? (response.data as Record<string, unknown>)
                : undefined;

        return {
            code: typeof value.code === 'string' ? value.code : undefined,
            message: typeof value.message === 'string' ? value.message : undefined,
            response: {
                status:
                    typeof response?.status === 'number' ? response.status : undefined,
                data: {
                    error: typeof data?.error === 'string' ? data.error : undefined,
                },
            },
        };
    }

    private addDays(date: string, days: number): string {
        const parsed = new Date(`${date}T00:00:00.000Z`);
        parsed.setUTCDate(parsed.getUTCDate() + days);
        return parsed.toISOString().slice(0, 10);
    }
}
