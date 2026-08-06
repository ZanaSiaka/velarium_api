import { IsDateString, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { EvenementType } from '../../../../generated/prisma/client';

export class CreateEvenementDto {
  @IsNotEmpty()
  title: string;

  @IsOptional()
  description?: string;

  @IsDateString()
  start: string;

  @IsOptional()
  @IsDateString()
  end?: string;

  @IsOptional()
  color?: string;

  @IsEnum(EvenementType)
  eventType: EvenementType;

  @IsOptional()
  location?: string;

  @IsOptional()
  dossierId?: string;
}
