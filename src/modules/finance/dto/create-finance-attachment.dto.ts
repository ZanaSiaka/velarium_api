import {
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    Max,
    Min,
} from 'class-validator';

export class CreateFinanceAttachmentDto {
    @IsString()
    @IsNotEmpty()
    nom: string;

    @IsString()
    @IsNotEmpty()
    storageKey: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(10 * 1024 * 1024)
    taille?: number;

    @IsOptional()
    @IsString()
    type?: string;
}