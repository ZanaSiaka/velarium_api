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
    SourceMouvementFinance,
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

    /**
     * Source du mouvement.
     *
     * Obligatoire fonctionnellement pour
     * ENTREE et SORTIE.
     *
     * Pour TRANSFERT, le backend impose
     * automatiquement TRANSFERT.
     */
    @IsOptional()
    @IsEnum(SourceMouvementFinance)
    source?: SourceMouvementFinance;

    /**
     * Description libre de la source.
     *
     * Obligatoire lorsque source = AUTRE.
     */
    @IsOptional()
    @IsString()
    sourceLibelle?: string;

    /**
     * Référence de la source :
     * reçu, facture fournisseur,
     * référence bancaire, etc.
     */
    @IsOptional()
    @IsString()
    sourceReference?: string;

    /**
     * Client, fournisseur, bailleur,
     * bénéficiaire, payeur...
     */
    @IsOptional()
    @IsString()
    tiers?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsDateString()
    date?: string;

    /**
     * Référence interne historique
     * du mouvement.
     */
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