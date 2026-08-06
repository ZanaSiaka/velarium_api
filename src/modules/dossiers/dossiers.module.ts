import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { DossiersService } from './dossiers.service';
import { DossiersController } from './dossiers.controller';

@Module({
  imports: [PrismaModule, ActivityLogModule],
  controllers: [DossiersController],
  providers: [DossiersService],
})
export class DossiersModule {}
