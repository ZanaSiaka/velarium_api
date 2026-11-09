import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { DossiersService } from './dossiers.service';
import { DossiersController } from './dossiers.controller';

import { FinancePermissionService } from '../finance/finance-permission.service';

@Module({
  imports: [PrismaModule, ActivityLogModule],
  controllers: [DossiersController],
  providers: [DossiersService, FinancePermissionService],
})
export class DossiersModule {}
