import {
    IsDateString,
    IsEnum,
    IsNumber,
    IsOptional,
    IsString,
    Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
    CategorieFinance,
    TypeMouvementFinance,
} from '../../../../generated/prisma/client';

export class CreateMouvementDto {
    @IsEnum(TypeMouvementFinance)
    type: TypeMouvementFinance;

    @Type(() => Number)
    @IsNumber()
    @Min(0.01)
    montant: number;

    @IsEnum(CategorieFinance)
    categorie: CategorieFinance;

    @IsString()
    caisseId: string;

    @IsOptional()
    @IsString()
    caisseDestinationId?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsDateString()
    date?: string;

    @IsOptional()
    @IsString()
    reference?: string;

    @IsOptional()
    @IsString()
    pieceJointe?: string;

    @IsOptional()
    @IsString()
    dossierId?: string;
}