import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PersonnesSuiviesController, SanctionsController } from './sanctions.controller';
import { SanctionsService } from './sanctions.service';
import { SanctionsGuard } from './sanctions.guard';
import { SanctionsStorageService } from './sanctions-storage.service';

@Module({
  imports: [PrismaModule],
  controllers: [PersonnesSuiviesController, SanctionsController],
  providers: [SanctionsService, SanctionsGuard, SanctionsStorageService],
})
export class SanctionsModule {}

