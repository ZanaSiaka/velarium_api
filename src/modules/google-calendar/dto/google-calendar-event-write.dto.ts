import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsBoolean,
    IsNotEmpty,
    IsOptional,
    IsString,
} from 'class-validator';

export class GoogleCalendarEventWriteDto {
    @ApiProperty({ example: 'Audience' })
    @IsString()
    @IsNotEmpty()
    title: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    location?: string;

    @ApiProperty({ example: '2026-10-01T09:00:00.000Z' })
    @IsString()
    @IsNotEmpty()
    start: string;

    @ApiPropertyOptional({ example: '2026-10-01T10:00:00.000Z' })
    @IsOptional()
    @IsString()
    end?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    allDay?: boolean;
}
