import {
    IsDateString,
    IsEnum,
    IsOptional,
    IsString,
    MinLength,
} from 'class-validator';

enum TachePriorite {
    BASSE = 'BASSE',
    NORMALE = 'NORMALE',
    HAUTE = 'HAUTE',
    URGENTE = 'URGENTE',
}

enum TacheStatut {
    A_FAIRE = 'A_FAIRE',
    EN_COURS = 'EN_COURS',
    TERMINEE = 'TERMINEE',
    ANNULEE = 'ANNULEE',
}

export class CreateTaskDto {
    @IsString()
    @MinLength(1)
    titre: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsEnum(TachePriorite)
    priorite: TachePriorite;

    @IsOptional()
    @IsEnum(TacheStatut)
    statut?: TacheStatut;

    @IsOptional()
    @IsDateString()
    dateEcheance?: string;

    @IsString()
    assigneAId: string;

    @IsOptional()
    @IsString()
    dossierId?: string;
}