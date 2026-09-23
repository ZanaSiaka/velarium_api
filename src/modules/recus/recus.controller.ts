import {
    Controller,
    Get,
    Header,
    Param,
    Query,
    Res,
    StreamableFile,
} from '@nestjs/common';

import {
    ApiBearerAuth,
    ApiTags,
} from '@nestjs/swagger';

import type {
    Response,
} from 'express';

import {
    RecusService,
} from './recus.service';

@ApiTags('recus')
@ApiBearerAuth()
@Controller('recus')
export class RecusController {
    constructor(
        private readonly recusService:
            RecusService,
    ) { }

    // ============================================================
    // LISTE
    // ============================================================

    @Get()
    findAll(
        @Query('dossierId')
        dossierId?: string,
    ) {
        return this.recusService.findAll(
            dossierId,
        );
    }

    // ============================================================
    // PDF
    // ============================================================

    @Get(':id/pdf')
    async downloadPdf(
        @Param('id')
        id: string,

        @Res({
            passthrough: true,
        })
        response: Response,
    ) {
        const {
            buffer,
            filename,
        } =
            await this.recusService
                .generatePdf(
                    id,
                );

        response.setHeader(
            'Content-Type',
            'application/pdf',
        );

        response.setHeader(
            'Content-Disposition',
            `attachment; filename="${filename}"`,
        );

        response.setHeader(
            'Content-Length',
            buffer.length,
        );

        return new StreamableFile(
            buffer,
        );
    }

    // ============================================================
    // VERSION IMPRIMABLE
    // ============================================================

    @Get(':id/print')
    @Header(
        'Content-Type',
        'text/html; charset=utf-8',
    )
    async print(
        @Param('id')
        id: string,
    ) {
        return this.recusService
            .generatePrintHtml(
                id,
            );
    }

    // ============================================================
    // DETAIL
    //
    // Toujours placer cette route APRES /pdf et /print.
    // ============================================================

    @Get(':id')
    findOne(
        @Param('id')
        id: string,
    ) {
        return this.recusService.findOne(
            id,
        );
    }
}