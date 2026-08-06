import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { ProvisionsService } from './provisions.service';
import { CreateProvisionDto } from './dto/create-provision.dto';

@ApiTags('provisions')
@ApiBearerAuth()
@Controller('provisions')
export class ProvisionsController {
  constructor(private readonly provisionsService: ProvisionsService) {}

  @Get()
  findAll(@Query('dossierId') dossierId?: string) {
    return this.provisionsService.findAll(dossierId);
  }

  @Post()
  create(@Body() dto: CreateProvisionDto) {
    return this.provisionsService.create(dto);
  }
}
