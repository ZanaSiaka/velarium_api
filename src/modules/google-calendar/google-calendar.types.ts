export type GoogleCalendarSyncResult = {
    syncedAt: Date;
    created: number;
    updated: number;
    deleted: number;
};

export type GoogleCalendarOAuthState = {
    sub: string;
    nonce: string;
    iat: number;
    exp: number;
};

export type GoogleCalendarEventsResponse<T> = {
    items: T[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
    };
};
