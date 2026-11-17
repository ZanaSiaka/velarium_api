import {
    IsInt,
    IsNotEmpty,
    IsString,
    Max,
    MaxLength,
    Min,
} from 'class-validator';

export class PresignFinanceAttachmentDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    filename: string;

    @IsString()
    @IsNotEmpty()
    contentType: string;

    @IsInt()
    @Min(1)
    @Max(10 * 1024 * 1024)
    taille: number;
}
