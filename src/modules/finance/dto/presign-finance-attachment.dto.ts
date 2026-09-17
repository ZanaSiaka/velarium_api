import {
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    Max,
    Min,
} from 'class-validator';

export class PresignFinanceAttachmentDto {
    @IsString()
    @IsNotEmpty()
    filename: string;

    @IsString()
    @IsNotEmpty()
    contentType: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(10 * 1024 * 1024)
    taille?: number;
}