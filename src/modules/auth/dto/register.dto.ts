import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  name: string;

  @IsEmail()
  @IsString()
  @MaxLength(254)
  email: string;

  @MinLength(8)
  @IsString()
  @MaxLength(1024)
  password: string;
}
