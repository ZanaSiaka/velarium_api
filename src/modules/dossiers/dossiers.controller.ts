import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { DossiersService } from './dossiers.service';
import { CreateDossierDto } from './dto/create-dossier.dto';
import { UpdateDossierDto } from './dto/update-dossier.dto';

@ApiTags('dossiers')
@ApiBearerAuth()
@Controller('dossiers')
export class DossiersController {
  constructor(private readonly dossiersService: DossiersService) {}

  @Get()
  findAll() {
    return this.dossiersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.dossiersService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateDossierDto, @CurrentUser() user: CurrentUserPayload) {
    return this.dossiersService.create(dto, user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDossierDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.dossiersService.update(id, dto, user.id);
  }
}
