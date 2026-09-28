import { Type } from 'class-transformer';
import {
    IsDateString,
    IsInt,
    IsOptional,
    Max,
    Min,
    Matches,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GoogleCalendarEventsQueryDto {
    @ApiPropertyOptional({ example: '2026-09-01' })
    @IsOptional()
    @Matches(/^\d{4}-\d{2}-\d{2}$/)
    @IsDateString({ strict: true })
    from?: string;

    @ApiPropertyOptional({ example: '2026-10-31' })
    @IsOptional()
    @Matches(/^\d{4}-\d{2}-\d{2}$/)
    @IsDateString({ strict: true })
    to?: string;

    @ApiPropertyOptional({ minimum: 1, default: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page = 1;

    @ApiPropertyOptional({ minimum: 1, maximum: 250, default: 100 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(250)
    limit = 100;
}
