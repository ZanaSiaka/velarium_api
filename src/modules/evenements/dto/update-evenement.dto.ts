import { PartialType } from '@nestjs/swagger';
import { CreateEvenementDto } from './create-evenement.dto';

export class UpdateEvenementDto extends PartialType(CreateEvenementDto) {}
