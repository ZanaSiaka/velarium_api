import { calendar_v3 } from 'googleapis';
import { Prisma } from '../../../generated/prisma/client';

function parseGoogleDate(value?: string | null): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseAllDayDate(value?: string | null): Date | null {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    return new Date(`${value}T00:00:00.000Z`);
}

export function mapGoogleEvent(
    event: calendar_v3.Schema$Event,
    connectionId: string,
    calendarId: string,
): Prisma.GoogleCalendarEventUncheckedCreateInput {
    if (!event.id) {
        throw new Error('Google Calendar returned an event without an id.');
    }

    const isAllDay = Boolean(event.start?.date);

    return {
        connectionId,
        googleEventId: event.id,
        googleCalendarId: calendarId,
        title: event.summary ?? null,
        description: event.description ?? null,
        location: event.location ?? null,
        startAt: isAllDay ? null : parseGoogleDate(event.start?.dateTime),
        endAt: isAllDay ? null : parseGoogleDate(event.end?.dateTime),
        startDate: isAllDay ? parseAllDayDate(event.start?.date) : null,
        endDate: isAllDay ? parseAllDayDate(event.end?.date) : null,
        isAllDay,
        status: event.status ?? null,
        eventType: event.eventType ?? null,
        htmlLink: event.htmlLink ?? null,
        hangoutLink: event.hangoutLink ?? null,
        organizerEmail: event.organizer?.email ?? null,
        creatorEmail: event.creator?.email ?? null,
        recurringEventId: event.recurringEventId ?? null,
        recurrence: event.recurrence ?? [],
        ...(event.attendees
            ? {
                attendees: JSON.parse(
                    JSON.stringify(event.attendees),
                ) as Prisma.InputJsonValue,
            }
            : {}),
        etag: event.etag ?? null,
        googleCreatedAt: parseGoogleDate(event.created),
        googleUpdatedAt: parseGoogleDate(event.updated),
    };
}
