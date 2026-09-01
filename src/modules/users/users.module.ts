import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { S3Module } from '../../common/s3/s3.module';

import { UsersService } from './users.service';
import { UserPiecesService } from './user-pieces.service';
import { UsersController } from './users.controller';

@Module({
  imports: [
    PrismaModule,
    S3Module,
  ],
  controllers: [
    UsersController,
  ],
  providers: [
    UsersService,
    UserPiecesService,
  ],
})
export class UsersModule { }