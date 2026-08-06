import { IsDateString, IsNotEmpty, IsNumber, IsOptional, Min } from 'class-validator';

export class CreateProvisionDto {
  @IsNotEmpty()
  dossierId: string;

  @IsNumber()
  @Min(0.01)
  montant: number;

  @IsOptional()
  @IsDateString()
  datePaiement?: string;

  @IsOptional()
  note?: string;
}
