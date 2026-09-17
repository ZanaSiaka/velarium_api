import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { ProvisionsService } from './provisions.service';

import { CreateProvisionDto } from './dto/create-provision.dto';
import { AssignProvisionDto } from './dto/assign-provision.dto';

@ApiTags('provisions')
@ApiBearerAuth()
@Controller('provisions')
export class ProvisionsController {
  constructor(
    private readonly provisionsService: ProvisionsService,
  ) { }

  @Get()
  findAll(@Query('dossierId') dossierId?: string) {
    return this.provisionsService.findAll(dossierId);
  }

  @Post()
  create(@Body() dto: CreateProvisionDto) {
    return this.provisionsService.create(dto);
  }

  @Patch(':id/facture')
  assignToFacture(
    @Param('id') id: string,
    @Body() dto: AssignProvisionDto,
  ) {
    return this.provisionsService.assignToFacture(
      id,
      dto.factureId,
    );
  }

  @Patch(':id/unassign-facture')
  unassignFromFacture(@Param('id') id: string) {
    return this.provisionsService.unassignFromFacture(id);
  }
}