import { Type } from 'class-transformer';

import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class LigneFactureDto {
  @IsNotEmpty()
  @IsString()
  description: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  quantite: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  prixUnitaire: number;
}

export class CreateFactureDto {
  @IsNotEmpty()
  @IsString()
  dossierId: string;

  @IsDateString()
  dateEcheance: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LigneFactureDto)
  lignes: LigneFactureDto[];
}
