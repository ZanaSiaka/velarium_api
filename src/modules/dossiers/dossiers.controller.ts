import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common'

import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'

import {
  CurrentUser,
  CurrentUserPayload,
} from '../../common/decorators/current-user.decorator'

import { DossiersService } from './dossiers.service'
import { CreateDossierDto } from './dto/create-dossier.dto'
import { UpdateDossierDto } from './dto/update-dossier.dto'
import { Roles } from '../../common/decorators/roles.decorator'
import { Role } from '../../../generated/prisma/client'
import { ActivityLogService } from '../activity-log/activity-log.service'
import { DossierHistoryQueryDto } from '../activity-log/dto/dossier-history-query.dto'

@ApiTags('dossiers')
@ApiBearerAuth()
@Controller('dossiers')
export class DossiersController {
  constructor(
    private readonly dossiersService: DossiersService,
    private readonly activityLogService: ActivityLogService,
  ) { }

  // ============================================================
  // LISTE
  // ============================================================

  @Get()
  findAll() {
    return this.dossiersService.findAll()
  }

  // ============================================================
  // DOSSIERS ARCHIVÉS
  // ============================================================

  @Get('archives')
  findArchived() {
    return this.dossiersService.findArchived()
  }

  // ============================================================
  // DÉTAIL
  // ============================================================

  @Get(':id/livre-paiements')
  @Header('Cache-Control', 'private, no-store')
  getLivrePaiements(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.dossiersService.getLivrePaiements(id, user.role)
  }

  @Get(':id/historique')
  @Roles(Role.AVOCAT)
  @Header('Cache-Control', 'private, no-store')
  async history(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: DossierHistoryQueryDto,
  ) {
    await this.activityLogService.assertDossierHistoryAccess(user.id)
    // Reuse current dossier access rules; do not add an assignment restriction.
    await this.dossiersService.findOne(id)
    return this.activityLogService.findDossierHistory(id, user.id, query)
  }
  @Get('frais-ouverture')
  findFraisOuverture() {
    return this.dossiersService
      .findFraisOuverture();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.dossiersService.findOne(id)
  }

  // ============================================================
  // CRÉATION
  // ============================================================

  @Post()
  create(
    @Body() dto: CreateDossierDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.dossiersService.create(
      dto,
      user.id,
    )
  }

  // ============================================================
  // MODIFICATION
  // ============================================================

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDossierDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.dossiersService.update(
      id,
      dto,
      user.id,
    )
  }

  // ============================================================
  // ARCHIVAGE
  // ============================================================

  @Patch(':id/archive')
  archive(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.dossiersService.archive(
      id,
      user.id,
    )
  }

  // ============================================================
  // DÉSARCHIVAGE
  // ============================================================

  @Patch(':id/unarchive')
  unarchive(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.dossiersService.unarchive(
      id,
      user.id,
    )
  }
}
