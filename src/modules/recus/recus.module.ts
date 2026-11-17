import { FinancePermissionService } from '../finance/finance-permission.service';
import { FinancialDataGuard } from '../../common/guards/financial-data.guard';
import {
    Module,
} from '@nestjs/common';

import {
    PrismaModule,
} from '../../prisma/prisma.module';

import {
    RecusController,
} from './recus.controller';

import {
    RecusService,
} from './recus.service';

@Module({
    imports: [
        PrismaModule,
    ],

    controllers: [
        RecusController,
    ],

    providers: [FinancialDataGuard, FinancePermissionService,
        RecusService,
    ],

    exports: [
        RecusService,
    ],
})
export class RecusModule { }
