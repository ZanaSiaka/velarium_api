import {
    IsNotEmpty,
    IsNumber,
    IsString,
    Min,
} from 'class-validator';

import { Type } from 'class-transformer';

export class CreateImputationProvisionDto {
    @IsNotEmpty()
    @IsString()
    factureId: string;

    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0.01)
    montant: number;
}
