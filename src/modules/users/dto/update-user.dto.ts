import { IsBoolean, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { Role } from '../../../../generated/prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
