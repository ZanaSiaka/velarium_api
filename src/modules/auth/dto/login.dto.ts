import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @IsString()
  @MaxLength(254)
  email: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(1024)
  password: string;
}
