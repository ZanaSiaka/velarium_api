import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
}
  from 'class-validator'

import { DossierStatut } from '../../../../generated/prisma/client'

export class CreateDossierDto {
  // ============================================================
  // INFORMATIONS DU DOSSIER
  // ============================================================

  @IsNotEmpty()
  @IsString()
  natureAffaire: string

  @IsNotEmpty()
  @IsString()
  typeDossier: string

  @IsEnum(DossierStatut)
  statut: DossierStatut

  // ============================================================
  // CLIENT
  // ============================================================

  @IsNotEmpty()
  @IsString()
  clientId: string

  // ============================================================
  // AVOCAT RESPONSABLE
  // ============================================================

  @IsNotEmpty()
  @IsString()
  avocatResponsableId: string

  // ============================================================
  // AVOCAT DU CLIENT
  // ============================================================

  @IsOptional()
  @IsString()
  avocatClientNom?: string

  @IsOptional()
  @IsEmail()
  avocatClientEmail?: string

  @IsOptional()
  @IsString()
  avocatClientTelephone?: string

  // ============================================================
  // COLLABORATEURS
  // ============================================================

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  collaborateurIds?: string[]

  // ============================================================
  // INFORMATIONS JURIDIQUES
  // ============================================================

  @IsOptional()
  @IsString()
  juridiction?: string

  @IsOptional()
  @IsString()
  partieAdverse?: string

  // ============================================================
  // KYC
  // ============================================================

  @IsBoolean()
  kycSoupcon: boolean

  @IsOptional()
  @IsString()
  declarationSoupcon?: string
}