import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

import { Type } from 'class-transformer';

import {
  MoyenOperationCompte,
} from '../../../../generated/prisma/client';

export class CreateProvisionDto {
  // ============================================================
  // DOSSIER
  // ============================================================

  @IsNotEmpty()
  @IsString()
  dossierId: string;

  // ============================================================
  // MONTANT
  // ============================================================

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  montant: number;

  // ============================================================
  // COMPTE D'ENCAISSEMENT
  // ============================================================

  @IsNotEmpty()
  @IsString()
  caisseId: string;

  // ============================================================
  // MOYEN DE PAIEMENT
  // ============================================================

  @IsNotEmpty()
  @IsEnum(MoyenOperationCompte)
  moyenPaiement: MoyenOperationCompte;

  // ============================================================
  // DATE
  // ============================================================

  @IsOptional()
  @IsDateString()
  datePaiement?: string;

  // ============================================================
  // REFERENCE DU PAIEMENT
  // ============================================================

  @IsOptional()
  @IsString()
  reference?: string;

  // ============================================================
  // NOTE
  // ============================================================

  @IsOptional()
  @IsString()
  note?: string;
}