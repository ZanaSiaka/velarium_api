import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { EvenementsService } from './evenements.service';
import { EvenementsController } from './evenements.controller';

@Module({
  imports: [PrismaModule],
  controllers: [EvenementsController],
  providers: [EvenementsService],
})
export class EvenementsModule {}
