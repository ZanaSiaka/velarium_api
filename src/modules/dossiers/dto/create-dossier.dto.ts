import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

import { Type } from 'class-transformer';

import {
  DossierStatut,
  MoyenOperationCompte,
} from '../../../../generated/prisma/client';

export class CreateDossierDto {
  // ============================================================
  // INFORMATIONS DU DOSSIER
  // ============================================================

  @IsNotEmpty()
  @IsString()
  natureAffaire: string;

  @IsNotEmpty()
  @IsString()
  typeDossier: string;

  @IsEnum(DossierStatut)
  statut: DossierStatut;

  // ============================================================
  // CLIENT
  // ============================================================

  @IsNotEmpty()
  @IsString()
  clientId: string;

  // ============================================================
  // AVOCAT RESPONSABLE
  // ============================================================

  @IsNotEmpty()
  @IsString()
  avocatResponsableId: string;

  // ============================================================
  // AVOCAT DU CLIENT
  // ============================================================

  @IsOptional()
  @IsString()
  avocatClientNom?: string;

  @IsOptional()
  @IsEmail()
  avocatClientEmail?: string;

  @IsOptional()
  @IsString()
  avocatClientTelephone?: string;

  // ============================================================
  // COLLABORATEURS
  // ============================================================

  @IsOptional()
  @IsArray()
  @IsString({
    each: true,
  })
  collaborateurIds?: string[];

  // ============================================================
  // INFORMATIONS JURIDIQUES
  // ============================================================

  @IsOptional()
  @IsString()
  juridiction?: string;

  @IsOptional()
  @IsString()
  partieAdverse?: string;

  // ============================================================
  // KYC
  // ============================================================

  @IsBoolean()
  kycSoupcon: boolean;

  @IsOptional()
  @IsString()
  declarationSoupcon?: string;

  // ============================================================
  // FRAIS D'OUVERTURE
  // ============================================================

  /**
   * Montant final réellement dû.
   *
   * Exemple :
   * 100000 = exactement 100 000 FCFA.
   *
   * Aucune TVA n'est ajoutée.
   */
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  montantFraisOuverture: number;

  /**
   * true :
   * le montant a réellement été encaissé.
   *
   * false :
   * le montant reste à payer.
   */
  @IsBoolean()
  fraisOuvertureRegles: boolean;

  // ============================================================
  // COMPTE D'ENCAISSEMENT
  // Obligatoire uniquement si les frais sont payés
  // ============================================================

  @ValidateIf(
    (dto: CreateDossierDto) =>
      dto.fraisOuvertureRegles === true,
  )
  @IsNotEmpty()
  @IsString()
  caisseIdFraisOuverture?: string;

  // ============================================================
  // MOYEN DE PAIEMENT
  // ============================================================

  @ValidateIf(
    (dto: CreateDossierDto) =>
      dto.fraisOuvertureRegles === true,
  )
  @IsNotEmpty()
  @IsEnum(MoyenOperationCompte)
  moyenPaiementFraisOuverture?: MoyenOperationCompte;

  // ============================================================
  // REFERENCE PAIEMENT
  // ============================================================

  @IsOptional()
  @IsString()
  referencePaiementFraisOuverture?: string;

  // ============================================================
  // DATE DU PAIEMENT
  // ============================================================

  @IsOptional()
  @IsDateString()
  datePaiementFraisOuverture?: string;
}