import { FinancePermissionService } from '../finance/finance-permission.service';
import { FinancialDataGuard } from '../../common/guards/financial-data.guard';
import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';

import { PaiementsController } from './paiements.controller';
import { PaiementsService } from './paiements.service';

@Module({
    imports: [PrismaModule],
    controllers: [PaiementsController],
    providers: [FinancialDataGuard, FinancePermissionService,PaiementsService],
})
export class PaiementsModule { }
