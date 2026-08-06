import { IsEmail, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { ClientType } from '../../../../generated/prisma/client';

export class CreateClientDto {
  @IsEnum(ClientType)
  type: ClientType;

  @IsNotEmpty()
  nom: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  telephone?: string;

  @IsOptional()
  adresse?: string;

  @IsOptional()
  notes?: string;
}
