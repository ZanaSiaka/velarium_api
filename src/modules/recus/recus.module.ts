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

    providers: [
        RecusService,
    ],

    exports: [
        RecusService,
    ],
})
export class RecusModule { }