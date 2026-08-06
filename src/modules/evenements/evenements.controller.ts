import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { EvenementsService } from './evenements.service';
import { CreateEvenementDto } from './dto/create-evenement.dto';
import { UpdateEvenementDto } from './dto/update-evenement.dto';

@ApiTags('evenements')
@ApiBearerAuth()
@Controller('evenements')
export class EvenementsController {
  constructor(private readonly evenementsService: EvenementsService) {}

  @Get()
  findAll(@Query('dossierId') dossierId?: string) {
    return this.evenementsService.findAll(dossierId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.evenementsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateEvenementDto, @CurrentUser() user: CurrentUserPayload) {
    return this.evenementsService.create(dto, user.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateEvenementDto) {
    return this.evenementsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.evenementsService.remove(id);
  }
}
