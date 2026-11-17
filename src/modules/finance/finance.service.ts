import { lockTreasuryAccounts, readTreasuryAccounts, serializeTreasuryAccount, treasuryAmount, treasuryCurrency, treasuryTransaction } from '../../common/finance/treasury';
import { isUUID, validateSync } from 'class-validator';
import { CreateDossierExpenseDto, DOSSIER_EXPENSE_CATEGORIES } from './dto/create-dossier-expense.dto';
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import {
    PrismaService,
} from '../../prisma/prisma.service';

import {
    ActivityLogService,
} from '../activity-log/activity-log.service';

import {
    FinancePermissionService,
} from './finance-permission.service';

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
    MoyenOperationCompte,
    CategorieFinance,
    Prisma,
    Role,
    SourceMouvementFinance,
    TypeCaisse,
} from '../../../generated/prisma/client';

type CreatedMouvement = Omit<Prisma.MouvementFinanceGetPayload<{ include: {
    caisse: { select: { id: true; nom: true; type: true } };
    caisseDestination: { select: { id: true; nom: true; type: true } };
    user: { select: { id: true; name: true; email: true } };
    dossier: { select: { id: true; reference: true } };
} }>, 'montant'> & { montant: number };
@Injectable()
export class FinanceService {

    constructor(
        private readonly prisma:
            PrismaService,

        private readonly activityLog:
            ActivityLogService,

        private readonly permissions:
            FinancePermissionService,
    ) { }

    // ============================================================
    // HELPERS
    // ============================================================

    private normalizeOptionalText(
        value?: string,
    ): string | null {
        if (
            value === undefined ||
            value === null
        ) {
            return null;
        }

        const normalized =
            value.trim();

        return normalized.length >
            0
            ? normalized
            : null;
    }

    private getDefaultMoyensOperation(
        type: TypeCaisse,
    ): MoyenOperationCompte[] {

        switch (type) {

            case TypeCaisse.BANCAIRE:
                return [
                    MoyenOperationCompte.VIREMENT,
                    MoyenOperationCompte.CHEQUE,
                ];

            case TypeCaisse.EPARGNE:
                return [
                    MoyenOperationCompte.VIREMENT,
                ];

            case TypeCaisse.CARTE_BANCAIRE:
                return [
                    MoyenOperationCompte.CARTE,
                ];

            case TypeCaisse.MOBILE_MONEY:
                return [
                    MoyenOperationCompte.MOBILE_MONEY,
                ];

            case TypeCaisse.ESPECES:
                return [
                    MoyenOperationCompte.ESPECES,
                ];

            default:
                return [];
        }
    }

    // ============================================================
    // COMPTES
    //
    // Le modèle Prisma s'appelle encore "Caisse"
    // pendant la phase de transition.
    // ============================================================

    async findCaisses(role: Role) {
        this.permissions.require(this.permissions.canViewCaisses(role), 'Consultation des comptes non autorisée.');
        return this.prisma.$transaction(async tx => (await readTreasuryAccounts(tx)).map(serializeTreasuryAccount), { isolationLevel: 'RepeatableRead' });
    }

    async findCaisse(id: string, role: Role, db: Prisma.TransactionClient | PrismaService = this.prisma) {
        this.permissions.require(this.permissions.canViewCaisses(role), 'Consultation des comptes non autorisée.');
        const read = async (client: Prisma.TransactionClient) => {
            const account = (await readTreasuryAccounts(client, [id]))[0];
            if (!account) throw new NotFoundException('Compte introuvable.');
        const mouvements =
            await client.mouvementFinance.findMany({
                where: {
                    OR: [
                        {
                            caisseId:
                                id,
                        },

                        {
                            caisseDestinationId:
                                id,
                        },
                    ],
                },

                orderBy: {
                    date:
                        'desc',
                },

                include: {
                    user: {
                        select: {
                            id:
                                true,

                            name:
                                true,

                            email:
                                true,
                        },
                    },

                    dossier: {
                        select: {
                            id:
                                true,

                            reference:
                                true,
                        },
                    },

                    caisse: {
                        select: {
                            id:
                                true,

                            nom:
                                true,

                            type:
                                true,
                        },
                    },

                    caisseDestination: {
                        select: {
                            id:
                                true,

                            nom:
                                true,

                            type:
                                true,
                        },
                    },
                },
            });


            return { ...serializeTreasuryAccount(account), mouvements: mouvements.map(row => ({
                ...row, montant: row.montant.toNumber(), montantExact: row.montant.toFixed(2),
            })) };
        };
        return db === this.prisma ? this.prisma.$transaction(read, { isolationLevel: 'RepeatableRead' }) : read(db);
    }

    async createCaisse(dto: CreateCaisseDto, userId: string, role: Role) {
        this.permissions.require(this.permissions.canCreateCaisse(role), 'Création du compte non autorisée.');
        if (!dto.nom?.trim() || !dto.type) throw new BadRequestException('Nom et type du compte obligatoires.');
        const initial = treasuryAmount(dto.soldeInitial ?? 0, true);
        const currency = treasuryCurrency(dto.devise ?? 'XOF');
        return treasuryTransaction(this.prisma, async tx => {
            const account = await tx.caisse.create({ data: {
                nom: dto.nom.trim(), type: dto.type, devise: currency, soldeInitial: initial,
                institution: this.normalizeOptionalText(dto.institution), identifiant: this.normalizeOptionalText(dto.identifiant),
                titulaire: this.normalizeOptionalText(dto.titulaire), moyensOperation: dto.moyensOperation ?? this.getDefaultMoyensOperation(dto.type),
                active: dto.active ?? true,
            } });
            await this.activityLog.log({ userId, action: 'CAISSE_CREEE', entityType: 'Caisse', entityId: account.id,
                metadata: { nom: account.nom, type: account.type, institution: account.institution, identifiant: account.identifiant,
                    titulaire: account.titulaire, moyensOperation: account.moyensOperation, soldeInitial: initial.toNumber() } }, tx);
            return serializeTreasuryAccount({ ...account, totalEntrees: new Prisma.Decimal(0), totalSorties: new Prisma.Decimal(0), solde: initial, hasHistory: false });
        });
    }

    async updateCaisse(id: string, dto: UpdateCaisseDto, userId: string, role: Role) {
        this.permissions.require(this.permissions.canUpdateCaisse(role), 'Modification du compte non autorisée.');
        return treasuryTransaction(this.prisma, async tx => {
            await lockTreasuryAccounts(tx, [id]);
            const current = (await readTreasuryAccounts(tx, [id]))[0];
            if (!current) throw new NotFoundException('Compte introuvable.');
            for (const key of ['nom', 'type', 'devise', 'soldeInitial', 'active', 'moyensOperation'] as const) {
                if (dto[key] === null) throw new BadRequestException('Une valeur obligatoire du compte ne peut pas être effacée.');
            }
            if (dto.nom !== undefined && !dto.nom.trim()) throw new BadRequestException('Le nom du compte ne peut pas être vide.');
            const initial = dto.soldeInitial === undefined ? current.soldeInitial : treasuryAmount(dto.soldeInitial, true);
            // Sending an unchanged historical currency is allowed; reinterpreting history is not.
            const currency = dto.devise === undefined || dto.devise === current.devise ? current.devise : treasuryCurrency(dto.devise);
            if (current.hasHistory && (!initial.equals(current.soldeInitial) || currency !== current.devise || (dto.type !== undefined && dto.type !== current.type))) {
                throw new BadRequestException('Le solde initial, le type et la devise sont immuables lorsque le compte possède un historique financier.');
            }
            if (dto.active === false && current.active && !current.solde.minus(current.soldeInitial).plus(initial).isZero()) {
                throw new BadRequestException('Le solde du compte doit être nul avant sa désactivation.');
            }
            const updated = await tx.caisse.update({ where: { id }, data: {
                ...(dto.nom !== undefined ? { nom: dto.nom.trim() } : {}),
                ...(dto.type !== undefined ? { type: dto.type } : {}),
                ...(dto.devise !== undefined ? { devise: currency } : {}),
                ...(dto.soldeInitial !== undefined ? { soldeInitial: initial } : {}),
                ...(dto.institution !== undefined ? { institution: this.normalizeOptionalText(dto.institution) } : {}),
                ...(dto.identifiant !== undefined ? { identifiant: this.normalizeOptionalText(dto.identifiant) } : {}),
                ...(dto.titulaire !== undefined ? { titulaire: this.normalizeOptionalText(dto.titulaire) } : {}),
                ...(dto.moyensOperation !== undefined ? { moyensOperation: dto.moyensOperation } :
                    dto.type !== undefined && dto.type !== current.type ? { moyensOperation: this.getDefaultMoyensOperation(dto.type) } : {}),
                ...(dto.active !== undefined ? { active: dto.active } : {}),
            } });
            await this.activityLog.log({ userId, action: 'CAISSE_MODIFIEE', entityType: 'Caisse', entityId: id,
                metadata: { nom: updated.nom, active: updated.active, type: updated.type, devise: updated.devise,
                    institution: updated.institution, identifiant: updated.identifiant, titulaire: updated.titulaire,
                    moyensOperation: updated.moyensOperation, soldeInitial: initial.toNumber() } }, tx);
            return serializeTreasuryAccount({ ...current, ...updated, solde: current.solde.minus(current.soldeInitial).plus(initial) });
        });
    }

    async deleteCaisse(id: string, userId: string, role: Role) {
        this.permissions.require(this.permissions.canDeleteCaisse(role), 'Suppression du compte non autorisée.');
        return treasuryTransaction(this.prisma, async tx => {
            await lockTreasuryAccounts(tx, [id]);
            const current = (await readTreasuryAccounts(tx, [id]))[0];
            if (!current) throw new NotFoundException('Compte introuvable.');
            if (!current.solde.isZero()) throw new BadRequestException('Le solde du compte doit être nul avant sa suppression.');
            if (current.hasHistory) throw new BadRequestException('Ce compte possède un historique financier et ne peut pas être supprimé.');
            await tx.caisse.delete({ where: { id } });
            await this.activityLog.log({ userId, action: 'CAISSE_SUPPRIMEE', entityType: 'Caisse', entityId: id,
                metadata: { nom: current.nom, type: current.type, soldeInitial: current.soldeInitial.toNumber() } }, tx);
            return { success: true };
        });
    }

    async findMouvements(
        role: Role,
        options?: {
            caisseId?: string;
            dossierId?: string;

            type?:
            | 'ENTREE'
            | 'SORTIE'
            | 'TRANSFERT';

            dateDebut?: string;
            dateFin?: string;
            categorie?: string;
            avecTotaux?: boolean;
        },
    ) {
        this.permissions.require(
            this.permissions.canViewMouvements(
                role,
            ),
            'Vous n’avez pas les permissions nécessaires pour consulter les mouvements financiers.',
        );

        const where: Prisma.MouvementFinanceWhereInput = {};
        if (options?.categorie) {
            if (!Object.values(CategorieFinance).includes(options.categorie as CategorieFinance)) throw new BadRequestException('Catégorie financière invalide.');
            where.categorie = options.categorie as CategorieFinance;
        }

        if (
            options?.caisseId
        ) {
            where.OR = [
                {
                    caisseId:
                        options.caisseId,
                },

                {
                    caisseDestinationId:
                        options.caisseId,
                },
            ];
        }

        if (
            options?.dossierId
        ) {
            where.dossierId =
                options.dossierId;
        }

        if (
            options?.type
        ) {
            where.type =
                options.type;
        }

        if (
            options?.dateDebut ||
            options?.dateFin
        ) {
            where.date = {};

            if (
                options.dateDebut
            ) {
                const dateDebut =
                    new Date(
                        options.dateDebut,
                    );

                if (
                    Number.isNaN(
                        dateDebut.getTime(),
                    )
                ) {
                    throw new BadRequestException(
                        'La date de début est invalide.',
                    );
                }

                where.date.gte =
                    dateDebut;
            }

            if (
                options.dateFin
            ) {
                const dateFin =
                    new Date(
                        options.dateFin,
                    );

                if (
                    Number.isNaN(
                        dateFin.getTime(),
                    )
                ) {
                    throw new BadRequestException(
                        'La date de fin est invalide.',
                    );
                }

                dateFin.setHours(
                    23,
                    59,
                    59,
                    999,
                );

                where.date.lte =
                    dateFin;
            }
        }

        const mouvements =
            await this.prisma.mouvementFinance.findMany({
                where,

                orderBy: {
                    date:
                        'desc',
                },

                include: {
                    caisse: {
                        select: {
                            id:
                                true,

                            nom:
                                true,

                            type:
                                true,
                            devise: true,
                        },
                    },

                    caisseDestination: {
                        select: {
                            id:
                                true,

                            nom:
                                true,

                            type:
                                true,
                            devise: true,
                        },
                    },

                    user: {
                        select: {
                            id:
                                true,

                            name:
                                true,

                            email:
                                true,
                        },
                    },

                    dossier: {
                        select: {
                            id:
                                true,

                            reference:
                                true,
                        },
                    },
                },
            });

        const items = mouvements.map(mouvement => ({
            ...mouvement, montant: Number(mouvement.montant), montantExact: mouvement.montant.toFixed(2),
        }));
        if (!options?.avecTotaux) return items;
        // Same filtered result, one query; no frontend floating-point sums.
        const totals = new Map<string, Prisma.Decimal>();
        let sansDevise = 0;
        for (const row of mouvements) {
            const devise = row.caisse.devise?.trim();
            if (!devise) { sansDevise++; continue; }
            totals.set(devise, (totals.get(devise) ?? new Prisma.Decimal(0)).plus(row.montant));
        }
        return { items, totauxParDevise: [...totals].map(([devise, montant]) => ({ devise, montant: montant.toFixed(2) })), sansDevise };

    }

    // ============================================================
    // CREATION MOUVEMENT
    // ============================================================

    async listDossierExpenseAccounts(role: Role) {
        this.permissions.require(this.permissions.canCreateMouvement(role) && this.permissions.canViewCaisses(role), 'Enregistrement des dépenses non autorisé.');
        return this.prisma.caisse.findMany({
            where: { active: true, devise: 'XOF' }, orderBy: { nom: 'asc' },
            select: { id: true, nom: true },
        });
    }

    private async dossierExpenseAccount(id: string, db: Prisma.TransactionClient | PrismaService) {
        const caisse = await db.caisse.findUnique({ where: { id } });
        if (!caisse) throw new NotFoundException('Compte sélectionné introuvable.');
        if (!caisse.active) throw new BadRequestException('Le compte sélectionné est inactif.');
        if (caisse.devise !== 'XOF') throw new BadRequestException('Le compte sélectionné est incompatible avec une dépense en XOF. Les devises historiques ne sont pas converties automatiquement.');
        return caisse;
    }

    private dossierExpensePaymentMethod(caisse: { type: TypeCaisse; moyensOperation: MoyenOperationCompte[] }) {
        const configured = caisse.moyensOperation.length ? caisse.moyensOperation : this.getDefaultMoyensOperation(caisse.type);
        const methods = [...new Set(configured.flatMap(method =>
            method === MoyenOperationCompte.CARTE ? [MoyenOperationCompte.PAIEMENT_CARTE] :
            method === MoyenOperationCompte.MOBILE_MONEY ? [MoyenOperationCompte.ORANGE_MONEY, MoyenOperationCompte.WAVE, MoyenOperationCompte.MTN_MONEY, MoyenOperationCompte.MOOV_MONEY] : [method]))];
        // The Prisma field is nullable: never invent a method when several are possible.
        return methods.length === 1 ? methods[0] : undefined;
    }

    private dossierExpenseTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, idempotent = false) {
        return treasuryTransaction(this.prisma, work, idempotent);
    }

    async createDossierExpense(dossierId: string, dto: CreateDossierExpenseDto, userId: string, role: Role, requestKey?: string) {
        this.permissions.require(this.permissions.canCreateMouvement(role) && this.permissions.canViewCaisses(role), 'Enregistrement des dépenses non autorisé.');
        if (!dto || validateSync(Object.assign(new CreateDossierExpenseDto(), dto), { whitelist: true, forbidNonWhitelisted: true }).length ||
            !dto.motif?.trim() || !dto.caisseId?.trim() || !requestKey || !isUUID(requestKey, '4')) {
            throw new BadRequestException('Nature, motif, montant, date, compte et identifiant de demande valides sont requis.');
        }
        const id = 'dossier-expense-' + requestKey;
        const date = new Date(dto.date);
        const amount = new Prisma.Decimal(dto.montant.toString());
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dto.date || amount.greaterThan('9999999999999.99')) {
            throw new BadRequestException('La date ou le montant de la dépense est invalide.');
        }
        return this.dossierExpenseTransaction(async tx => {
            const actor = await tx.user.findUnique({ where: { id: userId }, select: { active: true, role: true } });
            if (!actor?.active) throw new ForbiddenException('Utilisateur absent ou inactif.');
            this.permissions.require(this.permissions.canCreateMouvement(actor.role) && this.permissions.canViewCaisses(actor.role), 'Enregistrement des dépenses non autorisé.');
            const dossier = await tx.dossier.findUnique({ where: { id: dossierId }, select: { id: true, reference: true } });
            if (!dossier) throw new NotFoundException('Dossier introuvable.');
            const existing = await tx.mouvementFinance.findUnique({ where: { id } });
            if (existing) {
                if (existing.userId !== userId || existing.dossierId !== dossierId || existing.type !== 'SORTIE' ||
                    existing.caisseId !== dto.caisseId || existing.categorie !== dto.categorie || !existing.montant.equals(amount) ||
                    existing.description !== dto.motif.trim() || existing.date.getTime() !== date.getTime()) {
                    throw new ConflictException('Cette demande a déjà été utilisée avec d’autres données. Vérifiez les dépenses enregistrées.');
                }
                return { id: existing.id };
            }
            await lockTreasuryAccounts(tx, [dto.caisseId]);
            const caisse = await this.dossierExpenseAccount(dto.caisseId, tx);
            const mouvement = await this.createMouvement({
                type: 'SORTIE', dossierId, caisseId: caisse.id, moyenPaiement: this.dossierExpensePaymentMethod(caisse),
                categorie: dto.categorie, description: dto.motif.trim(), montant: dto.montant, date: dto.date,
                source: SourceMouvementFinance.AUTRE, sourceLibelle: 'Dépense du dossier ' + dossier.reference,
            }, userId, actor.role, tx, id);
            return { id: mouvement.id };
        }, true);
    }

    async createMouvement(
        dto: CreateMouvementDto,
        userId: string,
        role: Role,
        tx?: Prisma.TransactionClient,
        movementId?: string,
    ): Promise<CreatedMouvement> {
        const db = tx ?? this.prisma;
        this.permissions.require(
            this.permissions.canCreateMouvement(
                role,
            ),
            'Vous n’avez pas les permissions nécessaires pour enregistrer un mouvement financier.',
        );

        if (!tx) return treasuryTransaction(this.prisma, client => this.createMouvement(dto, userId, role, client, movementId));
        const requestedAmount = treasuryAmount(dto.montant);
        await lockTreasuryAccounts(tx, dto.type === 'TRANSFERT' && dto.caisseDestinationId ? [dto.caisseId, dto.caisseDestinationId] : [dto.caisseId]);
        if (dto.type === 'SORTIE' && dto.dossierId) {
            await this.dossierExpenseAccount(dto.caisseId, db);
            if (!DOSSIER_EXPENSE_CATEGORIES.some(category => category === dto.categorie) || !dto.description?.trim() || !dto.date) {
                throw new BadRequestException('Nature, motif, montant et date de dépense sont obligatoires.');
            }
        }

        // ============================================================
        // MONTANT
        // ============================================================

        if (
            !Number.isFinite(
                dto.montant,
            ) ||
            dto.montant <= 0
        ) {
            throw new BadRequestException(
                'Le montant doit être supérieur à zéro.',
            );
        }

        // ============================================================
        // SOURCE
        // ============================================================

        let sourceMouvement:
            SourceMouvementFinance;

        /**
         * Un transfert a toujours TRANSFERT
         * comme source.
         *
         * L'utilisateur n'a donc pas besoin
         * de sélectionner sa source.
         */
        if (
            dto.type ===
            'TRANSFERT'
        ) {
            sourceMouvement =
                SourceMouvementFinance.TRANSFERT;
        } else {
            /**
             * Pour toute ENTREE ou SORTIE manuelle,
             * la source est obligatoire.
             */
            if (!dto.source) {
                throw new BadRequestException(
                    'La source du mouvement est obligatoire.',
                );
            }

            /**
             * Certaines sources ne doivent jamais
             * être créées manuellement depuis Finance.
             *
             * Elles sont générées par leurs modules
             * métier afin d'éviter les doubles entrées.
             */
            const sourcesAutomatiques:
                SourceMouvementFinance[] = [
                    SourceMouvementFinance.PAIEMENT_FACTURE,
                    SourceMouvementFinance.PROVISION,
                    SourceMouvementFinance.FRAIS_OUVERTURE_DOSSIER,
                    SourceMouvementFinance.TRANSFERT,
                ];

            if (
                sourcesAutomatiques.includes(
                    dto.source,
                )
            ) {
                throw new BadRequestException(
                    'Cette source est générée automatiquement par Velarium et ne peut pas être utilisée pour un mouvement manuel.',
                );
            }

            sourceMouvement =
                dto.source;
        }

        const sourceLibelle =
            this.normalizeOptionalText(
                dto.sourceLibelle,
            );

        /**
         * AUTRE signifie que l'utilisateur doit
         * obligatoirement préciser la vraie source.
         */
        if (
            sourceMouvement ===
            SourceMouvementFinance.AUTRE &&
            !sourceLibelle
        ) {
            throw new BadRequestException(
                'Veuillez préciser la source du mouvement.',
            );
        }

        const sourceReference =
            this.normalizeOptionalText(
                dto.sourceReference,
            );

        const tiers =
            this.normalizeOptionalText(
                dto.tiers,
            );

        // ============================================================
        // COMPTE SOURCE
        // ============================================================

        const caisse =
            await db.caisse.findUnique({
                where: {
                    id:
                        dto.caisseId,
                },
            });

        if (!caisse) {
            throw new NotFoundException(
                'Compte source introuvable.',
            );
        }

        if (!caisse.active) {
            throw new BadRequestException(
                'Ce compte est désactivé.',
            );
        }

        if (treasuryCurrency(caisse.devise) !== caisse.devise) throw new BadRequestException('Devise historique incompatible avec une nouvelle opération.');
        if (dto.moyenPaiement) {
            const configured = caisse.moyensOperation?.length ? caisse.moyensOperation : this.getDefaultMoyensOperation(caisse.type);
            const allowed: MoyenOperationCompte[] = configured.flatMap(method => method === MoyenOperationCompte.CARTE
                ? [MoyenOperationCompte.PAIEMENT_CARTE]
                : method === MoyenOperationCompte.MOBILE_MONEY
                  ? [MoyenOperationCompte.ORANGE_MONEY, MoyenOperationCompte.WAVE, MoyenOperationCompte.MTN_MONEY, MoyenOperationCompte.MOOV_MONEY]
                  : [method]);
            if (!allowed.includes(dto.moyenPaiement)) throw new BadRequestException('Ce moyen de paiement n’est pas autorisé pour ce compte.');
        }
        if (dto.type === 'SORTIE' && dto.dossierId && dto.categorie === CategorieFinance.AUTRE && !dto.description?.trim()) {
            throw new BadRequestException('Veuillez préciser la nature de cette autre dépense.');
        }

        // ============================================================
        // DOSSIER
        // ============================================================

        if (dto.dossierId) {
            const dossier =
                await db.dossier.findUnique({
                    where: {
                        id:
                            dto.dossierId,
                    },
                });

            if (!dossier) {
                throw new NotFoundException(
                    'Dossier introuvable.',
                );
            }
        }

        // ============================================================
        // SOLDE DU COMPTE
        // ============================================================

        const accountBalance = (await readTreasuryAccounts(tx, [dto.caisseId]))[0];
        if (!accountBalance) throw new NotFoundException('Compte source introuvable.');
        if (dto.type === 'SORTIE' && requestedAmount.greaterThan(accountBalance.solde)) {
            throw new BadRequestException(dto.dossierId ? 'Le solde du compte sélectionné est insuffisant pour enregistrer cette dépense.' : 'Le solde du compte source est insuffisant pour cette opération.');
        }

        // ============================================================
        // TRANSFERT
        // ============================================================

        if (
            dto.type ===
            'TRANSFERT'
        ) {
            if (
                !dto.caisseDestinationId
            ) {
                throw new BadRequestException(
                    'Un compte destination est obligatoire pour un transfert.',
                );
            }

            if (
                dto.caisseDestinationId ===
                dto.caisseId
            ) {
                throw new BadRequestException(
                    'Le compte source et le compte destination doivent être différents.',
                );
            }

            const destination =
                await db.caisse.findUnique({
                    where: {
                        id:
                            dto.caisseDestinationId,
                    },
                });

            if (!destination) {
                throw new NotFoundException(
                    'Compte destination introuvable.',
                );
            }

            if (destination.devise !== caisse.devise) throw new BadRequestException('Les comptes du transfert doivent avoir la même devise. Aucune conversion n’est effectuée.');
            if (
                !destination.active
            ) {
                throw new BadRequestException(
                    'Le compte destination est désactivé.',
                );
            }

            if (
                requestedAmount.greaterThan(accountBalance.solde)
            ) {
                throw new BadRequestException(
                    'Le solde du compte source est insuffisant pour ce transfert.',
                );
            }
        }

        // ============================================================
        // DATE
        // ============================================================

        const date =
            dto.date
                ? new Date(
                    dto.date,
                )
                : new Date();

        if (
            Number.isNaN(
                date.getTime(),
            )
        ) {
            throw new BadRequestException(
                'La date du mouvement est invalide.',
            );
        }

        // ============================================================
        // CREATION
        // ============================================================

        const mouvement =
            await db.mouvementFinance.create({
                data: {
                    ...(movementId ? { id: movementId } : {}),
                    type:
                        dto.type,

                    montant:
                        requestedAmount,

                    categorie:
                        dto.categorie,

                    source:
                        sourceMouvement,

                    moyenPaiement: dto.moyenPaiement ?? null,

                    sourceLibelle,

                    sourceReference,

                    tiers,

                    description:
                        this.normalizeOptionalText(
                            dto.description,
                        ),

                    date,

                    reference:
                        this.normalizeOptionalText(
                            dto.reference,
                        ),

                    pieceJointe:
                        this.normalizeOptionalText(
                            dto.pieceJointe,
                        ),

                    caisseId:
                        dto.caisseId,

                    caisseDestinationId:
                        dto.type ===
                            'TRANSFERT'
                            ? dto.caisseDestinationId
                            : null,

                    userId,

                    dossierId:
                        dto.dossierId ??
                        null,
                },

                include: {
                    caisse: {
                        select: {
                            id:
                                true,

                            nom:
                                true,

                            type:
                                true,
                        },
                    },

                    caisseDestination: {
                        select: {
                            id:
                                true,

                            nom:
                                true,

                            type:
                                true,
                        },
                    },

                    user: {
                        select: {
                            id:
                                true,

                            name:
                                true,

                            email:
                                true,
                        },
                    },

                    dossier: {
                        select: {
                            id:
                                true,

                            reference:
                                true,
                        },
                    },
                },
            });

        // ============================================================
        // AUDIT
        // ============================================================

        await this.activityLog.log({
            userId,

            action:
                'MOUVEMENT_FINANCIER_CREE',

            entityType:
                'MouvementFinance',

            entityId:
                mouvement.id,

            dossierId:
                mouvement.dossierId ??
                undefined,

            metadata: {
                montantExact: mouvement.montant.toFixed(2),
                devise: caisse.devise,
                dateMetier: mouvement.date.toISOString(),
                type:
                    mouvement.type,

                montant:
                    Number(
                        mouvement.montant,
                    ),

                categorie:
                    mouvement.categorie,

                source:
                    mouvement.source,

                sourceLibelle:
                    mouvement.sourceLibelle,

                sourceReference:
                    mouvement.sourceReference,

                tiers:
                    mouvement.tiers,

                caisseId:
                    mouvement.caisseId,

                caisseDestinationId:
                    mouvement
                        .caisseDestinationId,
            },
        }, tx);

        return {
            ...mouvement,

            montant:
                Number(
                    mouvement.montant,
                ),
        };
    }

    // ============================================================
    // DASHBOARD
    // ============================================================

    async getDashboard(role: Role) {
        this.permissions.require(this.permissions.canViewFinance(role) && this.permissions.canViewCaisses(role), 'Consultation du tableau de bord financier non autorisée.');
        return this.prisma.$transaction(async tx => {
            const accounts = await readTreasuryAccounts(tx);
            const [flows, recent] = await Promise.all([
                tx.mouvementFinance.groupBy({ by: ['caisseId', 'type'], where: { type: { in: ['ENTREE', 'SORTIE'] } }, _sum: { montant: true } }),
                tx.mouvementFinance.findMany({ orderBy: { date: 'desc' }, take: 10, include: {
                    caisse: { select: { id: true, nom: true, type: true, devise: true } },
                    caisseDestination: { select: { id: true, nom: true, type: true, devise: true } },
                    user: { select: { id: true, name: true, email: true } }, dossier: { select: { id: true, reference: true } },
                } }),
            ]);
            const totals = new Map<string, { solde: Prisma.Decimal; totalEntrees: Prisma.Decimal; totalSorties: Prisma.Decimal }>();
            const accountCurrency = new Map(accounts.map(row => [row.id, row.devise]));
            for (const row of accounts) {
                const total = totals.get(row.devise) ?? { solde: new Prisma.Decimal(0), totalEntrees: new Prisma.Decimal(0), totalSorties: new Prisma.Decimal(0) };
                total.solde = total.solde.plus(row.solde);
                totals.set(row.devise, total);
            }
            for (const row of flows) {
                const total = totals.get(accountCurrency.get(row.caisseId)!);
                if (!total) continue;
                if (row.type === 'ENTREE') total.totalEntrees = total.totalEntrees.plus(row._sum.montant ?? 0);
                if (row.type === 'SORTIE') total.totalSorties = total.totalSorties.plus(row._sum.montant ?? 0);
            }
            const currency = totals.size === 0 ? 'XOF' : totals.size === 1 && /^[A-Z]{3}$/.test([...totals.keys()][0]) ? [...totals.keys()][0] : null;
            const global = currency ? totals.get(currency) ?? { solde: new Prisma.Decimal(0), totalEntrees: new Prisma.Decimal(0), totalSorties: new Prisma.Decimal(0) } : null;
            return {
                soldeGlobal: global?.solde.toNumber() ?? null, totalEntrees: global?.totalEntrees.toNumber() ?? null, totalSorties: global?.totalSorties.toNumber() ?? null,
                soldeGlobalExact: global?.solde.toFixed(2) ?? null, totalEntreesExact: global?.totalEntrees.toFixed(2) ?? null, totalSortiesExact: global?.totalSorties.toFixed(2) ?? null,
                deviseGlobale: currency,
                totauxParDevise: [...totals].map(([devise, total]) => ({ devise, solde: total.solde.toFixed(2), totalEntrees: total.totalEntrees.toFixed(2), totalSorties: total.totalSorties.toFixed(2) })),
                nombreCaisses: accounts.length, caisses: accounts.map(serializeTreasuryAccount),
                derniersMouvements: recent.map(row => ({ ...row, montant: row.montant.toNumber(), montantExact: row.montant.toFixed(2) })),
                permissions: this.permissions.getFinancePermissions(role),
            };
        }, { isolationLevel: 'RepeatableRead' });
    }
}
