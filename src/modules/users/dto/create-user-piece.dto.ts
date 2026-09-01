import {
    IsDateString,
    IsEnum,
    IsNotEmpty,
    IsOptional,
    IsString,
} from 'class-validator';

import { TypePieceUtilisateur } from '../../../../generated/prisma/client';

export class CreateUserPieceDto {
    @IsEnum(TypePieceUtilisateur)
    type: TypePieceUtilisateur;

    @IsNotEmpty()
    @IsString()
    nom: string;

    @IsNotEmpty()
    @IsString()
    url: string;

    @IsOptional()
    @IsDateString()
    dateExpiration?: string;

    @IsOptional()
    @IsString()
    contratId?: string;
}