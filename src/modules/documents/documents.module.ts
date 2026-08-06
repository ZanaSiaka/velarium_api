import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { S3Module } from '../../common/s3/s3.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';

@Module({
  imports: [PrismaModule, S3Module, ActivityLogModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
