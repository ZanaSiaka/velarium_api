import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiTags,
} from '@nestjs/swagger';

import type {
  Request,
} from 'express';

import {
  ProvisionsService,
} from './provisions.service';

import {
  CreateProvisionDto,
} from './dto/create-provision.dto';

import {
  CreateImputationProvisionDto,
} from './dto/create-imputation-provision.dto';

type AuthenticatedRequest =
  Request & {
    user?: {
      id?: string;
      userId?: string;
      sub?: string;
    };
  };

@ApiTags('provisions')
@ApiBearerAuth()
@Controller('provisions')
export class ProvisionsController {
  constructor(
    private readonly provisionsService:
      ProvisionsService,
  ) { }

  // ============================================================
  // LISTE
  // ============================================================

  @Get()
  findAll(
    @Query('dossierId')
    dossierId?: string,
  ) {
    return this.provisionsService.findAll(
      dossierId,
    );
  }

  // ============================================================
  // ENCAISSEMENT D'UNE PROVISION
  // ============================================================

  @Post()
  create(
    @Req()
    request: AuthenticatedRequest,

    @Body()
    dto: CreateProvisionDto,
  ) {
    const userId =
      request.user?.id ??
      request.user?.userId ??
      request.user?.sub;

    if (!userId) {
      throw new UnauthorizedException(
        'Utilisateur authentifié introuvable.',
      );
    }

    return this.provisionsService.create(
      dto,
      userId,
    );
  }
  // ============================================================
  // IMPUTATION D'UNE PROVISION
  // ============================================================

  @Post(':id/imputations')
  createImputation(
    @Req()
    request: AuthenticatedRequest,

    @Param('id')
    provisionId: string,

    @Body()
    dto: CreateImputationProvisionDto,
  ) {
    const userId =
      request.user?.id ??
      request.user?.userId ??
      request.user?.sub;

    if (!userId) {
      throw new UnauthorizedException(
        'Utilisateur authentifié introuvable.',
      );
    }

    return this.provisionsService.createImputation(
      provisionId,
      dto,
      userId,
    );
  }

  // ============================================================
  // RETRAIT D'UNE IMPUTATION
  // ============================================================

  @Delete(':id/imputations/:imputationId')
  removeImputation(
    @Param('id')
    provisionId: string,

    @Param('imputationId')
    imputationId: string,
  ) {
    return this.provisionsService.removeImputation(
      provisionId,
      imputationId,
    );
  }
}