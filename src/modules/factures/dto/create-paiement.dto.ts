import { IsDateString, IsNumber, IsOptional, Min } from 'class-validator';

export class CreatePaiementDto {
  @IsNumber()
  @Min(0.01)
  montant: number;

  @IsOptional()
  @IsDateString()
  datePaiement?: string;

  @IsOptional()
  moyenPaiement?: string;

  @IsOptional()
  note?: string;
}
