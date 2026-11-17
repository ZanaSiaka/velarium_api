import { IsString, Matches, MinLength } from 'class-validator';
import { BcryptPassword } from './auth-password.validator';

export class ResetPasswordDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  token: string;

  @MinLength(8)
  @IsString()
  @BcryptPassword()
  password: string;
}
