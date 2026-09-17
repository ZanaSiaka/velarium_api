import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';

import { PaiementsController } from './paiements.controller';
import { PaiementsService } from './paiements.service';

@Module({
    imports: [PrismaModule],
    controllers: [PaiementsController],
    providers: [PaiementsService],
})
export class PaiementsModule { }