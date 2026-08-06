import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { FacturesService } from './factures.service';
import { CreateFactureDto } from './dto/create-facture.dto';
import { CreatePaiementDto } from './dto/create-paiement.dto';

@ApiTags('factures')
@ApiBearerAuth()
@Controller('factures')
export class FacturesController {
  constructor(private readonly facturesService: FacturesService) {}

  @Get()
  findAll() {
    return this.facturesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.facturesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateFactureDto, @CurrentUser() user: CurrentUserPayload) {
    return this.facturesService.create(dto, user.id);
  }

  @Post(':id/paiements')
  addPaiement(
    @Param('id') id: string,
    @Body() dto: CreatePaiementDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.facturesService.addPaiement(id, dto, user.id);
  }
}
