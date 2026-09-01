import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../../common/decorators/roles.decorator';

import { Role } from '../../../generated/prisma/client';

import { UsersService } from './users.service';
import { UserPiecesService } from './user-pieces.service';

import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PresignUserPieceDto } from './dto/presign-user-piece.dto';
import { CreateUserPieceDto } from './dto/create-user-piece.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly userPiecesService: UserPiecesService,
  ) { }

  @Get()
  findAll() {
    return this.usersService.findAllForSelect();
  }

  @Roles(Role.AVOCAT)
  @Get('admin')
  findAllAdmin() {
    return this.usersService.findAllAdmin();
  }

  @Roles(Role.AVOCAT)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Roles(Role.AVOCAT)
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Roles(Role.AVOCAT)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(id, dto);
  }

  // ============================================================
  // PIÈCES ADMINISTRATIVES
  // ============================================================

  @Roles(Role.AVOCAT)
  @Post(':id/pieces/presign')
  presignPieceUpload(
    @Param('id') id: string,
    @Body() dto: PresignUserPieceDto,
  ) {
    return this.userPiecesService.presignUpload(
      id,
      dto,
    );
  }

  @Roles(Role.AVOCAT)
  @Post(':id/pieces')
  createPiece(
    @Param('id') id: string,
    @Body() dto: CreateUserPieceDto,
  ) {
    return this.userPiecesService.create(
      id,
      dto,
    );
  }

  @Roles(Role.AVOCAT)
  @Get(':id/pieces')
  findPieces(@Param('id') id: string) {
    return this.userPiecesService.findAll(id);
  }

  @Roles(Role.AVOCAT)
  @Get(':id/pieces/:pieceId/download')
  downloadPiece(
    @Param('id') id: string,
    @Param('pieceId') pieceId: string,
  ) {
    return this.userPiecesService.getDownloadUrl(
      id,
      pieceId,
    );
  }

  @Roles(Role.AVOCAT)
  @Delete(':id/pieces/:pieceId')
  deletePiece(
    @Param('id') id: string,
    @Param('pieceId') pieceId: string,
  ) {
    return this.userPiecesService.remove(
      id,
      pieceId,
    );
  }
}