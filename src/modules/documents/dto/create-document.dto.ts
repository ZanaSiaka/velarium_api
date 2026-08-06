import { IsEnum, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';
import { DocumentVisibilite } from '../../../../generated/prisma/client';

export class CreateDocumentDto {
  @IsNotEmpty()
  nom: string;

  @IsNotEmpty()
  dossierId: string;

  @IsNotEmpty()
  storageKey: string;

  @IsOptional()
  @IsNumber()
  taille?: number;

  @IsOptional()
  type?: string;

  @IsEnum(DocumentVisibilite)
  visibilite: DocumentVisibilite;
}
