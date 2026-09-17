import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { PaiementsService } from './paiements.service';

@ApiTags('paiements')
@ApiBearerAuth()
@Controller('paiements')
export class PaiementsController {
    constructor(
        private readonly paiementsService: PaiementsService,
    ) { }

    @Get()
    findAll() {
        return this.paiementsService.findAll();
    }
}