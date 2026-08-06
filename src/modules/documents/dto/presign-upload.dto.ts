import { IsNotEmpty } from 'class-validator';

export class PresignUploadDto {
  @IsNotEmpty()
  filename: string;

  @IsNotEmpty()
  contentType: string;

  @IsNotEmpty()
  dossierId: string;
}
