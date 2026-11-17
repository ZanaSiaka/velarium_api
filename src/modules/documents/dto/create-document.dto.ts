import { IsEnum, IsNotEmpty, IsOptional, IsInt, IsString, Min, Max } from 'class-validator';
import { DocumentVisibilite } from '../../../../generated/prisma/client';

export class CreateDocumentDto {
  @IsNotEmpty()
  @IsString()
  nom: string;

  @IsNotEmpty()
  @IsString()
  dossierId: string;

  @IsNotEmpty()
  @IsString()
  storageKey: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  taille?: number;

  @IsOptional()
  @IsString()
  type?: string;

  @IsString()
  @IsNotEmpty()
  uploadToken: string;

  @IsEnum(DocumentVisibilite)
  visibilite: DocumentVisibilite;
}
