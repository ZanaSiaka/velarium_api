import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { DossierStatut } from '../../../../generated/prisma/client';

export class CreateDossierDto {
  @IsNotEmpty()
  type: string;

  @IsEnum(DossierStatut)
  statut: DossierStatut;

  @IsNotEmpty()
  clientId: string;

  @IsNotEmpty()
  avocatResponsableId: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  collaborateurIds?: string[];

  @IsOptional()
  juridiction?: string;

  @IsOptional()
  partieAdverse?: string;
}
