import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class DossierHistoryQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class ActivityLogQueryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  dossierId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  userId?: string;
}
