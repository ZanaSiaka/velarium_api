// import { Module } from '@nestjs/common';

// import { PrismaModule } from '../../prisma/prisma.module';
// import { ActivityLogModule } from '../activity-log/activity-log.module';
// import { FacturesService } from './factures.service';
// import { FacturesController } from './factures.controller';

// @Module({
//   imports: [PrismaModule, ActivityLogModule],
//   controllers: [FacturesController],
//   providers: [FacturesService],
// })
// export class FacturesModule {}

import { Module } from '@nestjs/common';

import { FacturesController } from './factures.controller';
import { FacturesService } from './factures.service';

import { PrismaModule } from '../../prisma/prisma.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { FinanceModule } from '../finance/finance.module';

@Module({
  imports: [
    PrismaModule,
    ActivityLogModule,
    FinanceModule,
  ],

  controllers: [
    FacturesController,
  ],

  providers: [
    FacturesService,
  ],

  exports: [
    FacturesService,
  ],
})
export class FacturesModule { }