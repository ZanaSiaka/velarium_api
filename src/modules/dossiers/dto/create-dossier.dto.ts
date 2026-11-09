import { KycDeclarationValidator } from './kyc-declaration.validator';
import {
  IsArray,
  Validate,
  ValidateIf,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsPositive,
  Equals,
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
  // COORDONNEES HISTORIQUES : libelle UI avocat adverse, cles API conservees
  // ============================================================

  @IsOptional()
  @IsString()
  avocatClientNom?: string | null;

  @IsOptional()
  @IsEmail()
  avocatClientEmail?: string | null;

  @IsOptional()
  @IsString()
  avocatClientTelephone?: string | null;

  // ============================================================
  // COLLABORATEURS
  // ============================================================

  @ValidateIf((_dto, value) => value !== undefined)
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
  juridiction?: string | null;

  @IsOptional()
  @IsString()
  partieAdverse?: string | null;

  // ============================================================
  // KYC
  // ============================================================

  @IsBoolean()
  kycSoupcon: boolean;

  @Validate(KycDeclarationValidator)
  declarationSoupcon?: string | null;

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
  @IsPositive()
  montantFraisOuverture: number;

  /**
   * true :
   * le montant a réellement été encaissé.
   *
   * false est refusé lors de la création.
   */
  @IsBoolean()
  @Equals(true, { message: 'Les frais d’ouverture doivent être réglés lors de la création du dossier.' })
  fraisOuvertureRegles: boolean;

  // ============================================================
  // COMPTE D'ENCAISSEMENT
  // Obligatoire lors de la création
  // ============================================================

  @IsNotEmpty()
  @IsString()
  caisseIdFraisOuverture: string;

  // ============================================================
  // MOYEN DE PAIEMENT
  // ============================================================

  @IsNotEmpty()
  @IsEnum(MoyenOperationCompte)
  moyenPaiementFraisOuverture: MoyenOperationCompte;

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