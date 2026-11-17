import { CreateDossierExpenseDto } from './dto/create-dossier-expense.dto';
import {
    Body,
    Headers,
    Header,
    DefaultValuePipe,
    ParseBoolPipe,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
} from '@nestjs/common';

import {
    ApiBearerAuth,
    ApiTags,
} from '@nestjs/swagger';

import {
    CurrentUser,
    CurrentUserPayload,
} from '../../common/decorators/current-user.decorator';

import {
    FinanceService,
} from './finance.service';
import { FinancePermissionService } from './finance-permission.service';

import {
    FinanceAttachmentsService,
} from './finance-attachments.service';

import {
    CreateCaisseDto,
} from './dto/create-caisse.dto';

import {
    UpdateCaisseDto,
} from './dto/update-caisse.dto';

import {
    CreateMouvementDto,
} from './dto/create-mouvement.dto';

import {
    PresignFinanceAttachmentDto,
} from './dto/presign-finance-attachment.dto';

import {
    CreateFinanceAttachmentDto,
} from './dto/create-finance-attachment.dto';

@ApiTags('finance')
@ApiBearerAuth()
@Controller('finance')
export class FinanceController {
    constructor(
        private readonly financeService:
            FinanceService,

        private readonly financeAttachmentsService:
            FinanceAttachmentsService,
        private readonly financePermissions: FinancePermissionService,
    ) { }

    @Get('permissions')
    getPermissions(@CurrentUser() user: CurrentUserPayload) {
        return this.financePermissions.getFinancePermissions(user.role);
    }

    // ============================================================
    // DASHBOARD
    // ============================================================

    @Get('dashboard')
    getDashboard(
        @CurrentUser()
        user:
            CurrentUserPayload,
    ) {
        return this.financeService.getDashboard(
            user.role,
        );
    }

    // ============================================================
    // CAISSES
    // ============================================================

    @Get('caisses')
    findCaisses(
        @CurrentUser()
        user:
            CurrentUserPayload,
    ) {
        return this.financeService.findCaisses(
            user.role,
        );
    }

    @Get('caisses/:id')
    findCaisse(
        @Param('id')
        id:
            string,

        @CurrentUser()
        user:
            CurrentUserPayload,
    ) {
        return this.financeService.findCaisse(
            id,
            user.role,
        );
    }

    @Post('caisses')
    createCaisse(
        @Body()
        dto:
            CreateCaisseDto,

        @CurrentUser()
        user:
            CurrentUserPayload,
    ) {
        return this.financeService.createCaisse(
            dto,
            user.id,
            user.role,
        );
    }

    @Patch('caisses/:id')
    updateCaisse(
        @Param('id')
        id:
            string,

        @Body()
        dto:
            UpdateCaisseDto,

        @CurrentUser()
        user:
            CurrentUserPayload,
    ) {
        return this.financeService.updateCaisse(
            id,
            dto,
            user.id,
            user.role,
        );
    }

    @Delete('caisses/:id')
    deleteCaisse(
        @Param('id')
        id:
            string,

        @CurrentUser()
        user:
            CurrentUserPayload,
    ) {
        return this.financeService.deleteCaisse(
            id,
            user.id,
            user.role,
        );
    }

    // ============================================================
    // MOUVEMENTS
    // ============================================================

    @Get('mouvements')
    findMouvements(
        @CurrentUser()
        user:
            CurrentUserPayload,

        @Query('caisseId')
        caisseId?:
            string,

        @Query('dossierId')
        dossierId?:
            string,

        @Query('type')
        type?:
            | 'ENTREE'
            | 'SORTIE'
            | 'TRANSFERT',

        @Query('dateDebut')
        dateDebut?:
            string,

        @Query('dateFin')
        dateFin?:
            string,

        @Query('categorie') categorie?: string,
        @Query('avecTotaux', new DefaultValuePipe(false), ParseBoolPipe) avecTotaux?: boolean,
    ) {
        return this.financeService.findMouvements(
            user.role,
            {
                caisseId,
                dossierId,
                type,
                dateDebut,
                dateFin,
                categorie,
                avecTotaux,
            },
        );
    }

    @Get('comptes-depenses')
    @Header('Cache-Control', 'private, no-store')
    listDossierExpenseAccounts(@CurrentUser() user: CurrentUserPayload) {
        return this.financeService.listDossierExpenseAccounts(user.role);
    }

    @Post('dossiers/:dossierId/depenses')
    createDossierExpense(
        @Param('dossierId') dossierId: string,
        @Body() dto: CreateDossierExpenseDto,
        @CurrentUser() user: CurrentUserPayload,
        @Headers('idempotency-key') requestKey?: string,
    ) {
        return this.financeService.createDossierExpense(dossierId, dto, user.id, user.role, requestKey);
    }

    @Post('mouvements')
    createMouvement(
        @Body()
        dto:
            CreateMouvementDto,

        @CurrentUser()
        user:
            CurrentUserPayload,
    ) {
        return this.financeService.createMouvement(
            dto,
            user.id,
            user.role,
        );
    }

    // ============================================================
    // PIECES JOINTES FINANCE
    // ============================================================

    /**
     * Génère une URL présignée permettant au navigateur
     * d'envoyer directement le fichier vers Cloudflare R2.
     *
     * Selon FinancePermissionService.
     */
    @Post(
        'mouvements/:mouvementId/pieces-jointes/presign',
    )
    presignFinanceAttachment(
        @Param('mouvementId')
        mouvementId:
            string,

        @Body()
        dto:
            PresignFinanceAttachmentDto,

        @CurrentUser()
        user:
            CurrentUserPayload,
    ) {
        return this.financeAttachmentsService.presignUpload(
            mouvementId,
            dto,
            user.role,
            user.id,
        );
    }

    /**
     * Retourne les justificatifs d'un mouvement.
     *
     * AVOCAT + COMPTABLE.
     */
    @Get(
        'mouvements/:mouvementId/pieces-jointes',
    )
    @Header('Cache-Control', 'private, no-store')
    findFinanceAttachments(
        @Param('mouvementId')
        mouvementId:
            string,

        @CurrentUser()
        user:
            CurrentUserPayload,
    ) {
        return this.financeAttachmentsService.findAll(
            mouvementId,
            user.role,
        );
    }

    /**
     * Enregistre en base les métadonnées d'un fichier
     * déjà envoyé dans R2.
     *
     * Selon FinancePermissionService.
     */
    @Post(
        'mouvements/:mouvementId/pieces-jointes',
    )
    createFinanceAttachment(
        @Param('mouvementId')
        mouvementId:
            string,

        @Body()
        dto:
            CreateFinanceAttachmentDto,

        @CurrentUser()
        user:
            CurrentUserPayload,
    ) {
        return this.financeAttachmentsService.create(
            mouvementId,
            dto,
            user.id,
            user.role,
        );
    }

    /**
     * Génère une URL temporaire d'affichage inline.
     *
     * AVOCAT + COMPTABLE.
     */
    @Get(
        'pieces-jointes/:id/view',
    )
    @Header('Cache-Control', 'private, no-store')
    viewFinanceAttachment(
        @Param('id')
        id:
            string,

        @CurrentUser()
        user:
            CurrentUserPayload,
    ) {
        return this.financeAttachmentsService.getViewUrl(
            id,
            user.id,
            user.role,
        );
    }

    /**
     * Génère une URL temporaire de téléchargement.
     *
     * AVOCAT + COMPTABLE.
     */
    @Get(
        'pieces-jointes/:id/download',
    )
    @Header('Cache-Control', 'private, no-store')
    downloadFinanceAttachment(
        @Param('id')
        id:
            string,

        @CurrentUser()
        user:
            CurrentUserPayload,
    ) {
        return this.financeAttachmentsService.getDownloadUrl(
            id,
            user.id,
            user.role,
        );
    }

    /**
     * Supprime le fichier R2 puis son entrée Prisma.
     *
     * Selon FinancePermissionService.
     */
    @Delete(
        'pieces-jointes/:id',
    )
    deleteFinanceAttachment(
        @Param('id')
        id:
            string,

        @CurrentUser()
        user:
            CurrentUserPayload,
    ) {
        return this.financeAttachmentsService.remove(
            id,
            user.id,
            user.role,
        );
    }
}
