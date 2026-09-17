import {
    IsBoolean,
    IsEnum,
    IsNumber,
    IsOptional,
    IsString,
    Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TypeCaisse } from '../../../../generated/prisma/client';

export class UpdateCaisseDto {
    @IsOptional()
    @IsString()
    nom?: string;

    @IsOptional()
    @IsEnum(TypeCaisse)
    type?: TypeCaisse;

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