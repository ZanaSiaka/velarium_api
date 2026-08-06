import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  Min,
  ValidateNested,
} from 'class-validator';

export class LigneFactureDto {
  @IsNotEmpty()
  description: string;

  @IsNumber()
  @Min(0.01)
  quantite: number;

  @IsNumber()
  @Min(0)
  prixUnitaire: number;
}

export class CreateFactureDto {
  @IsNotEmpty()
  dossierId: string;

  @IsDateString()
  dateEcheance: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LigneFactureDto)
  lignes: LigneFactureDto[];
}
