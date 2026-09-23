import {
    IsArray,
    IsBoolean,
    IsEnum,
    IsNumber,
    IsNotEmpty,
    IsOptional,
    IsString,
    Min,
} from 'class-validator';

import {
    Type,
} from 'class-transformer';

import {
    MoyenOperationCompte,
    TypeCaisse,
} from '../../../../generated/prisma/client';

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
    @IsString()
    institution?: string;

    @IsOptional()
    @IsString()
    identifiant?: string;

    @IsOptional()
    @IsString()
    titulaire?: string;

    @IsOptional()
    @IsArray()
    @IsEnum(
        MoyenOperationCompte,
        {
            each: true,
        },
    )
    moyensOperation?: MoyenOperationCompte[];

    @IsOptional()
    @IsBoolean()
    active?: boolean;
}