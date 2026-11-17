import {
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    Max,
    MaxLength,
    Min,
} from 'class-validator';

export class CreateFinanceAttachmentDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(8192)
    uploadToken: string;
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
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
