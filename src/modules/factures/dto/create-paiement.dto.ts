import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

import {
  Type,
} from 'class-transformer';

import {
  MoyenOperationCompte,
} from '../../../../generated/prisma/client';

export class CreatePaiementDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  montant: number;

  @IsNotEmpty()
  @IsString()
  caisseId: string;

  @IsNotEmpty()
  @IsEnum(MoyenOperationCompte)
  moyenPaiement: MoyenOperationCompte;

  @IsOptional()
  @IsDateString()
  datePaiement?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  note?: string;
}