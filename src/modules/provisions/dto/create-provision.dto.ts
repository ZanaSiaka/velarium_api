import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateProvisionDto {
  @IsNotEmpty()
  @IsString()
  dossierId: string;

  @IsOptional()
  @IsString()
  factureId?: string;

  @IsNumber()
  @Min(0.01)
  montant: number;

  @IsOptional()
  @IsDateString()
  datePaiement?: string;

  @IsOptional()
  @IsString()
  moyenPaiement?: string;

  @IsOptional()
  @IsString()
  note?: string;
}