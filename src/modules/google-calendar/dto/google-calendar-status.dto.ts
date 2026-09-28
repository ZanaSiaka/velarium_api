import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GoogleCalendarConnectionStatus } from '../../../../generated/prisma/client';

export class GoogleCalendarStatusDto {
    @ApiProperty()
    connected: boolean;

    @ApiPropertyOptional({ enum: GoogleCalendarConnectionStatus })
    status?: GoogleCalendarConnectionStatus;

    @ApiPropertyOptional()
    googleEmail?: string | null;

    @ApiPropertyOptional()
    calendarId?: string;

    @ApiPropertyOptional({ nullable: true })
    lastSyncAt?: Date | null;

    @ApiPropertyOptional({ nullable: true })
    lastFullSyncAt?: Date | null;
}
