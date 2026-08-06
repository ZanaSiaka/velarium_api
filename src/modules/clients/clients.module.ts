import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { ClientsService } from './clients.service';
import { ClientsController } from './clients.controller';

@Module({
  imports: [PrismaModule, ActivityLogModule],
  controllers: [ClientsController],
  providers: [ClientsService],
})
export class ClientsModule {}
