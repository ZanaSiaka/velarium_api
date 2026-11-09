import { Body, CallHandler, Controller, ExecutionContext, Get, Header, Injectable, NestInterceptor, Param, Patch, Post, Query, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Role } from '../../../generated/prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { SanctionsGuard } from './sanctions.guard';
import { SanctionsService } from './sanctions.service';
import { SANCTION_MAX_FILE, SanctionFile } from './sanctions-storage.service';
import { CreatePersonneSuivieDto, CreateSanctionDto, DepotSanctionPieceDto, LienDossierPersonneDto, ListeSanctionsDto, PageSanctionsDto, PatchPersonneSuivieDto, PatchSanctionDto, RecherchePersonnesDto, TransitionSanctionDto } from './sanctions.dto';

@Injectable()
export class SanctionsNoStoreInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    context.switchToHttp().getResponse().setHeader('Cache-Control', 'private, no-store');
    return next.handle();
  }
}

@ApiTags('sanctions') @ApiBearerAuth() @Roles(Role.AVOCAT) @UseGuards(SanctionsGuard)
@Controller('personnes-suivies')
@UseInterceptors(SanctionsNoStoreInterceptor)
export class PersonnesSuiviesController {
  constructor(private readonly sanctions: SanctionsService) {}
  @Get() list(@CurrentUser() user: CurrentUserPayload, @Query() dto: RecherchePersonnesDto) { return this.sanctions.listPersonnes(user.id, dto); }
  @Post() create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreatePersonneSuivieDto) { return this.sanctions.createPersonne(user.id, dto); }
  @Get(':id/sanctions') sanctionsList(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Query() dto: ListeSanctionsDto) { return this.sanctions.listSignalements(user.id, id, dto); }
  @Post(':id/sanctions') createSanction(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Body() dto: CreateSanctionDto) { return this.sanctions.createSignalement(user.id, id, dto); }
  @Get(':id/dossiers') dossiers(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Query() dto: PageSanctionsDto) { return this.sanctions.listDossiers(user.id, id, dto); }
  @Post(':id/dossiers') link(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Body() dto: LienDossierPersonneDto) { return this.sanctions.linkDossier(user.id, id, dto); }
  @Get(':id/historique') history(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Query() dto: PageSanctionsDto) { return this.sanctions.historyList(user.id, id, dto, true); }
  @Get(':id') get(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) { return this.sanctions.getPersonne(user.id, id); }
  @Patch(':id') patch(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Body() dto: PatchPersonneSuivieDto) { return this.sanctions.patchPersonne(user.id, id, dto); }
}

@ApiTags('sanctions') @ApiBearerAuth() @Roles(Role.AVOCAT) @UseGuards(SanctionsGuard)
@Controller('sanctions')
@UseInterceptors(SanctionsNoStoreInterceptor)
export class SanctionsController {
  constructor(private readonly sanctions: SanctionsService) {}
  @Get(':id/historique') history(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Query() dto: PageSanctionsDto) { return this.sanctions.historyList(user.id, id, dto); }
  @Get(':id/pieces') pieces(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Query() dto: PageSanctionsDto) { return this.sanctions.listPieces(user.id, id, dto); }
  @Post(':id/pieces') @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: SANCTION_MAX_FILE, files: 1, fields: 3, fieldSize: 8192, parts: 5 } }))
  upload(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Body() dto: DepotSanctionPieceDto, @UploadedFile() file: SanctionFile) { return this.sanctions.uploadPiece(user.id, id, dto, file); }
  @Get(':id/pieces/:pieceId/contenu')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'; sandbox")
  async download(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Param('pieceId') pieceId: string) {
    const file = await this.sanctions.downloadPiece(user.id, id, pieceId);
    return new StreamableFile(file.bytes, { type: file.mimeType, disposition: 'attachment; filename="justificatif"', length: file.bytes.length });
  }
  @Post(':id/transitions') transition(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Body() dto: TransitionSanctionDto) { return this.sanctions.transition(user.id, id, dto); }
  @Patch(':id') patch(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Body() dto: PatchSanctionDto) { return this.sanctions.patchSignalement(user.id, id, dto); }
  @Get(':id') get(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) { return this.sanctions.getSignalement(user.id, id); }
}

