import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { ClientType } from '../../../../generated/prisma/client';

export class CreateClientDto {
  @IsEnum(ClientType)
  type: ClientType;

  @IsNotEmpty()
  @IsString()
  @Matches(/\S/)
  nom: string;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  telephone?: string | null;

  @IsOptional()
  @IsString()
  adresse?: string | null;

  @IsOptional()
  @IsString()
  numeroContribuable?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}
