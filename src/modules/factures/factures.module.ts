import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { FacturesService } from './factures.service';
import { FacturesController } from './factures.controller';

@Module({
  imports: [PrismaModule, ActivityLogModule],
  controllers: [FacturesController],
  providers: [FacturesService],
})
export class FacturesModule {}
