import {
    IsNotEmpty,
    IsString,
} from 'class-validator';

export class PresignUserPieceDto {
    @IsNotEmpty()
    @IsString()
    filename: string;

    @IsNotEmpty()
    @IsString()
    contentType: string;
}