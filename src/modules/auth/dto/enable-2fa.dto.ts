import { IsString, Matches } from 'class-validator';

export class Enable2faDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}
