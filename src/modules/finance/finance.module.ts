import {
    Module,
} from '@nestjs/common';

import {
    FinanceController,
} from './finance.controller';

import {
    FinanceService,
} from './finance.service';

import {
    FinancePermissionService,
} from './finance-permission.service';

import {
    FinanceAttachmentsService,
} from './finance-attachments.service';

import {
    PrismaModule,
} from '../../prisma/prisma.module';

import {
    ActivityLogModule,
} from '../activity-log/activity-log.module';

import {
    S3Module,
} from '../../common/s3/s3.module';

@Module({
    imports: [
        PrismaModule,

        ActivityLogModule,

        /**
         * Fournit le S3Service déjà utilisé
         * par le module Documents.
         *
         * On réutilise donc exactement
         * la même infrastructure Cloudflare R2.
         */
        S3Module,
    ],

    controllers: [
        FinanceController,
    ],

    providers: [
        FinanceService,

        FinancePermissionService,

        FinanceAttachmentsService,
    ],

    exports: [
        FinanceService,

        FinancePermissionService,

        FinanceAttachmentsService,
    ],
})
export class FinanceModule { }