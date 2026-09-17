import {
    IsBoolean,
    IsEnum,
    IsNumber,
    IsNotEmpty,
    IsOptional,
    IsString,
    Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TypeCaisse } from '../../../../generated/prisma/client';

export class CreateCaisseDto {
    @IsNotEmpty()
    @IsString()
    nom: string;

    @IsEnum(TypeCaisse)
    type: TypeCaisse;

    @IsOptional()
    @IsString()
    devise?: string;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    soldeInitial?: number;

    @IsOptional()
    @IsBoolean()
    active?: boolean;
}