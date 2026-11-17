import { Body, Controller, Delete, Get, Param, Post, Query, Header } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { DocumentsService } from './documents.service';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { CreateDocumentDto } from './dto/create-document.dto';

@ApiTags('documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) { }

  @Header('Cache-Control', 'private, no-store')
  @Get("folders")
  async findFolders(@CurrentUser() user: CurrentUserPayload) {
    return this.documentsService.findFolders(user.id)
  }
  @Header('Cache-Control', 'private, no-store')
  @Post('presign')
  presign(@Body() dto: PresignUploadDto, @CurrentUser() user: CurrentUserPayload) {
    return this.documentsService.presignUpload(dto, user.id);
  }

  @Header('Cache-Control', 'private, no-store')
  @Get()
  findAll(@CurrentUser() user: CurrentUserPayload, @Query('dossierId') dossierId?: string) {
    return this.documentsService.findAll(dossierId, user.id);
  }

  @Header('Cache-Control', 'private, no-store')
  @Post()
  create(@Body() dto: CreateDocumentDto, @CurrentUser() user: CurrentUserPayload) {
    return this.documentsService.create(dto, user.id);
  }

  @Header('Cache-Control', 'private, no-store')
  @Get(':id/download')
  download(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.documentsService.getDownloadUrl(id, user.id);
  }
  @Header('Cache-Control', 'private, no-store')
  @Get(':id/view')
  view(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.documentsService.getViewUrl(id, user.id);
  }

  @Header('Cache-Control', 'private, no-store')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.documentsService.remove(id, user.id);
  }
}
