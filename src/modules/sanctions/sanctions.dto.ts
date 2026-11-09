import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { PartialType, PickType } from '@nestjs/swagger';
import { ActionSanction, EtatMesureSanction, NaturePersonneSuivie, QualificationSanction } from '../../../generated/prisma/client';

export class PageSanctionsDto {
  @ValidateIf((_o, v) => v !== undefined) @Type(() => Number) @IsInt() @Min(1) @Max(500) page = 1;
  @ValidateIf((_o, v) => v !== undefined) @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
export class RecherchePersonnesDto extends PageSanctionsDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) recherche?: string;
}
export class ListeSanctionsDto extends PageSanctionsDto {
  @IsOptional() @IsEnum(QualificationSanction) qualification?: QualificationSanction;
  @IsOptional() @IsEnum(EtatMesureSanction) etatMesure?: EtatMesureSanction;
}
export class CreatePersonneSuivieDto {
  @IsEnum(NaturePersonneSuivie) nature: NaturePersonneSuivie;
  @IsString() @Matches(/\S/) @MaxLength(200) nom: string;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(200) clientId?: string | null;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(100) identifiantType?: string | null;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(200) identifiantValeur?: string | null;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(2000) justificationIdentite?: string | null;
  @ValidateIf((_o, v) => v !== undefined) @IsBoolean() identiteEtablie?: boolean;
}
export class LienDossierPersonneDto {
  @IsInt() @Min(1) version: number;
  @IsString() @Matches(/\S/) @MaxLength(200) dossierId: string;
  @IsIn(['CLIENT', 'PARTIE_ADVERSE', 'AVOCAT_ADVERSE', 'REPRESENTANT', 'AUTRE']) qualite: string;
  @IsString() @Matches(/\S/) @MinLength(8) @MaxLength(2000) motif: string;
}
export class PatchPersonneSuivieDto extends PartialType(CreatePersonneSuivieDto, { skipNullProperties: false }) {
  @IsInt() @Min(1) version: number;
  @IsString() @Matches(/\S/) @MinLength(8) @MaxLength(2000) motif: string;
}
export class CreateSanctionDto {
  @IsString() @Matches(/\S/) @MaxLength(150) type: string;
  @IsString() @Matches(/\S/) @MaxLength(1000) source: string;
  @IsString() @Matches(/\S/) @MaxLength(5000) description: string;
  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(2000) sourceUrl?: string | null;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(300) autorite?: string | null;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(300) referenceDecision?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) dateDecision?: string | null;
  @ValidateIf((_o, v) => v !== undefined) @IsBoolean() dateDecisionApplicable?: boolean;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(1000) motifDateDecisionAbsente?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) dateDebut?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) dateFin?: string | null;
}
export class PatchSanctionDto extends PartialType(CreateSanctionDto, { skipNullProperties: false }) {
  @IsInt() @Min(1) version: number;
  @IsString() @Matches(/\S/) @MinLength(8) @MaxLength(2000) motif: string;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(200) justificatifId?: string;
}
export class TransitionSanctionDto extends PartialType(PickType(CreateSanctionDto, ['dateDebut', 'dateFin'] as const), { skipNullProperties: false }) {
  @IsInt() @Min(1) version: number;
  @IsEnum(ActionSanction) action: ActionSanction;
  @IsString() @Matches(/\S/) @MinLength(8) @MaxLength(2000) motif: string;
  @IsOptional() @IsEnum(EtatMesureSanction) etatMesure?: EtatMesureSanction;
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(200) justificatifId?: string;
}
export class DepotSanctionPieceDto {
  @Type(() => Number) @IsInt() @Min(1) version: number;
  @IsString() @Matches(/\S/) @MinLength(8) @MaxLength(2000) motif: string;
  @IsString() @Matches(/\S/) @MinLength(3) @MaxLength(500) referenceSource: string;
}

