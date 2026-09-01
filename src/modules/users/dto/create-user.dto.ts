import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

import { Role, TypeContrat } from '../../../../generated/prisma/client';

export class CreateUserDto {
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @MinLength(8)
  password: string;

  @IsEnum(Role)
  role: Role;

  @IsOptional()
  @IsEnum(TypeContrat)
  typeContrat?: TypeContrat;

  @IsOptional()
  @IsDateString()
  dateDebutContrat?: string;

  @IsOptional()
  @IsDateString()
  dateFinContrat?: string;

  @IsOptional()
  @IsString()
  posteContrat?: string;
}