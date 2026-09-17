import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
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

  @Get("folders")
  async findFolders() {
    return this.documentsService.findFolders()
  }
  @Post('presign')
  presign(@Body() dto: PresignUploadDto) {
    return this.documentsService.presignUpload(dto);
  }

  @Get()
  findAll(@Query('dossierId') dossierId?: string) {
    return this.documentsService.findAll(dossierId);
  }

  @Post()
  create(@Body() dto: CreateDocumentDto, @CurrentUser() user: CurrentUserPayload) {
    return this.documentsService.create(dto, user.id);
  }

  @Get(':id/download')
  download(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.documentsService.getDownloadUrl(id, user.id);
  }
  @Get(':id/view')
  view(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.documentsService.getViewUrl(id, user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.documentsService.remove(id);
  }
}
