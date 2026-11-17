import { IsDateString, IsIn, IsNotEmpty, IsNumber, IsString, Matches, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CategorieFinance } from '../../../../generated/prisma/client';

export const DOSSIER_EXPENSE_CATEGORIES = [
  CategorieFinance.TRANSPORT, CategorieFinance.RESTAURATION, CategorieFinance.COMMUNICATION,
  CategorieFinance.FOURNITURES, CategorieFinance.IMPRESSION_PHOTOCOPIE, CategorieFinance.AUTRE,
];

export class CreateDossierExpenseDto {
  @IsString()
  @IsNotEmpty()
  caisseId: string;

  @IsIn(DOSSIER_EXPENSE_CATEGORIES)
  categorie: CategorieFinance;

  @IsString()
  @IsNotEmpty()
  motif: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  montant: number;

  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;
}
