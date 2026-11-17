import { PartialType } from '@nestjs/swagger';
import { CreateEvenementDto } from './create-evenement.dto';

// Required properties reject explicit null; nullable properties retain IsOptional.
export class UpdateEvenementDto extends PartialType(CreateEvenementDto, { skipNullProperties: false }) {}
