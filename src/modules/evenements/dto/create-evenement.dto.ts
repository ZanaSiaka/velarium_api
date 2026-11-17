import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { EvenementType } from '../../../../generated/prisma/client';

export class CreateEvenementDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsDateString({ strict: true })
  start: string;

  @IsOptional()
  @IsDateString({ strict: true })
  end?: string | null;

  @IsOptional()
  @IsString()
  color?: string | null;

  @IsEnum(EvenementType)
  eventType: EvenementType;

  @IsOptional()
  @IsString()
  location?: string | null;

  @IsOptional()
  @IsString()
  dossierId?: string | null;
}
