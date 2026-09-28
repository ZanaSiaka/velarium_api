import { Controller, Delete, Get, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import {
    CurrentUser,
    CurrentUserPayload,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { GoogleCalendarEventsQueryDto } from './dto/google-calendar-events-query.dto';
import { GoogleCalendarService } from './google-calendar.service';

@ApiTags('google-calendar')
@Controller('google-calendar')
export class GoogleCalendarController {
    constructor(private readonly googleCalendarService: GoogleCalendarService) { }

    @Get('connect')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Obtenir l’URL de connexion Google Calendar' })
    connect(@CurrentUser() user: CurrentUserPayload) {
        return this.googleCalendarService.getConnectUrl(user.id);
    }

    @Get('callback')
    @Public()
    @ApiOperation({ summary: 'Terminer la connexion OAuth Google Calendar' })
    async callback(
        @Query('code') code: string | undefined,
        @Query('state') state: string | undefined,
        @Res() response: Response,
    ) {
        const frontendUrl = process.env.FRONTEND_URL;
        if (!frontendUrl) {
            response.status(500).send('Google Calendar callback is not configured.');
            return;
        }

        let redirectUrl: URL;
        try {
            redirectUrl = new URL('/settings/integrations', frontendUrl);
            await this.googleCalendarService.handleCallback(code, state);
            redirectUrl.searchParams.set('googleCalendar', 'connected');
        } catch {
            redirectUrl = new URL('/settings/integrations', frontendUrl);
            redirectUrl.searchParams.set('googleCalendar', 'error');
        }
        response.redirect(redirectUrl.toString());
    }

    @Get('status')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Consulter le statut de connexion Google Calendar' })
    getStatus(@CurrentUser() user: CurrentUserPayload) {
        return this.googleCalendarService.getStatus(user.id);
    }

    @Get('events')
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Lister les événements Google Calendar synchronisés',
    })
    getEvents(
        @CurrentUser() user: CurrentUserPayload,
        @Query() query: GoogleCalendarEventsQueryDto,
    ) {
        return this.googleCalendarService.getEvents(user.id, query);
    }

    @Post('sync')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Synchroniser Google Calendar' })
    sync(@CurrentUser() user: CurrentUserPayload) {
        return this.googleCalendarService.syncForUser(user.id).then((result) => ({
            success: true,
            ...result,
        }));
    }

    @Delete('disconnect')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Révoquer et supprimer le cache Google Calendar' })
    disconnect(@CurrentUser() user: CurrentUserPayload) {
        return this.googleCalendarService.disconnect(user.id);
    }
}
