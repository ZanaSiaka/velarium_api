import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { BcryptPassword } from './auth-password.validator';

export class ChangePasswordDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(1024)
  oldPassword: string;

  @MinLength(8)
  @IsString()
  @BcryptPassword()
  newPassword: string;
}
