import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { ProvisionsService } from './provisions.service';
import { ProvisionsController } from './provisions.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ProvisionsController],
  providers: [ProvisionsService],
})
export class ProvisionsModule {}
