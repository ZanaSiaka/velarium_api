import {
    OmitType,
    PartialType,
} from '@nestjs/swagger';

import {
    CreateDossierDto,
} from './create-dossier.dto';

export class UpdateDossierDto extends PartialType(
    OmitType(
        CreateDossierDto,
        [
            'montantFraisOuverture',
            'fraisOuvertureRegles',
            'caisseIdFraisOuverture',
            'moyenPaiementFraisOuverture',
            'referencePaiementFraisOuverture',
            'datePaiementFraisOuverture',
        ] as const,
    ),
) { }