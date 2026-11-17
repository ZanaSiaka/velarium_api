import { IsInt, IsNotEmpty, IsString, Min, Max } from 'class-validator';

export class PresignUploadDto {
  @IsNotEmpty()
  @IsString()
  filename: string;

  @IsNotEmpty()
  @IsString()
  contentType: string;

  @IsNotEmpty()
  @IsString()
  dossierId: string;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  taille: number;
}
