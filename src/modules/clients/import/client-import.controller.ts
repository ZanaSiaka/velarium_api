import { Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Equals, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '../../../../generated/prisma/client';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { ClientImportService } from './client-import.service';
import { IMPORT_LIMITS, ImportUpload } from './client-workbook';

export class ConfirmClientImportDto {
  @IsString()
  @MinLength(20)
  @MaxLength(24000)
  token: string;

  @Equals('true', { message: 'La confirmation explicite est obligatoire.' })
  confirmed: string;
}
// Busboy emits partsLimit on the boundary at the limit; 4 permits the 3 expected parts.
const uploadOptions = { limits: { fileSize: IMPORT_LIMITS.bytes, files: 1, fields: 2, fieldSize: 24000, parts: 4 } };

@ApiTags('clients')
@ApiBearerAuth()
@Controller('clients/import')
@Roles(Role.AVOCAT)
export class ClientImportController {
  constructor(private readonly imports: ClientImportService) {}

  @Post('preview')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  preview(@UploadedFile() file: ImportUpload, @CurrentUser() user: CurrentUserPayload) {
    return this.imports.preview(file, user.id);
  }

  @Post('confirm')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  confirm(@UploadedFile() file: ImportUpload, @Body() dto: ConfirmClientImportDto, @CurrentUser() user: CurrentUserPayload) {
    return this.imports.confirm(file, user.id, dto.token, dto.confirmed);
  }
}
