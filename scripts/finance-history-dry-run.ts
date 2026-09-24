/**
 * VELARIUM — AUDIT / PLAN DE MIGRATION FINANCIÈRE (DRY-RUN)
 *
 * IMPORTANT :
 * - Ce script NE MODIFIE PAS PostgreSQL.
 * - Il fait uniquement des lectures Prisma.
 * - Il génère localement un fichier finance-migration-plan.json.
 * - Les frais d'ouverture PAYE sans mouvement sont signalés mais EXCLUS
 *   du plan de migration automatique pour éviter un double encaissement.
 *
 * Exécution :
 *
 *   npx ts-node -r tsconfig-paths/register scripts/finance-history-dry-run.ts \
 *     --from=2026-09-01 \
 *     --to=2026-09-23
 */

import 'dotenv/config'

import fs from 'node:fs'
import path from 'node:path'

import {
    PrismaClient,
} from '../generated/prisma/client'

import {
    PrismaPg,
} from '@prisma/adapter-pg'

// ============================================================
// PRISMA
//
// Reprend exactement la configuration utilisée par PrismaService
// dans Velarium : PrismaPg + DATABASE_URL.
// ============================================================

const connectionString =
    process.env.DATABASE_URL

if (!connectionString) {
    throw new Error(
        'DATABASE_URL est absente. Vérifie ton fichier .env à la racine du backend.',
    )
}

const adapter =
    new PrismaPg({
        connectionString,
    })

const prisma =
    new PrismaClient({
        adapter,
    })

type Candidate = {
    caisseId: string
    nom: string
    type: string
    active: boolean
    moyensOperation: string[]
    score: number
    raison: string
}

type MigrationItem = {
    kind:
    | 'PAIEMENT'
    | 'PROVISION'

    id: string
    date: string
    montant: number

    dossier:
    string | null

    facture:
    string | null

    moyenPaiement:
    string | null

    duplicateGroup:
    string | null

    candidates:
    Candidate[]

    selectedCaisseId:
    string

    migrate:
    boolean

    note:
    string
}

function money(
    value: unknown,
) {
    return Number(
        value ?? 0,
    )
}

function parseArg(
    name: string,
) {
    const prefix =
        `--${name}=`

    const arg =
        process.argv.find(
            (
                value,
            ) =>
                value.startsWith(
                    prefix,
                ),
        )

    return arg
        ? arg.slice(
            prefix.length,
        )
        : undefined
}

function parseDateStart(
    value?: string,
) {
    if (!value) {
        return undefined
    }

    const date =
        new Date(
            `${value}T00:00:00.000Z`,
        )

    if (
        Number.isNaN(
            date.getTime(),
        )
    ) {
        throw new Error(
            `Date --from invalide : ${value}`,
        )
    }

    return date
}

function parseDateEnd(
    value?: string,
) {
    if (!value) {
        return undefined
    }

    const date =
        new Date(
            `${value}T23:59:59.999Z`,
        )

    if (
        Number.isNaN(
            date.getTime(),
        )
    ) {
        throw new Error(
            `Date --to invalide : ${value}`,
        )
    }

    return date
}

function normalizeText(
    value?:
        | string
        | null,
) {
    return (
        value
            ?.trim()
            .toUpperCase()
            .normalize(
                'NFD',
            )
            .replace(
                /[\u0300-\u036f]/g,
                '',
            )
            .replace(
                /[\s-]+/g,
                '_',
            ) ??
        ''
    )
}

function normalizeMoyen(
    value?:
        | string
        | null,
) {
    const normalized =
        normalizeText(
            value,
        )

    const aliases:
        Record<
            string,
            string
        > = {
        ESPECE:
            'ESPECES',

        CASH:
            'ESPECES',

        CHEQUES:
            'CHEQUE',

        VIREMENTS:
            'VIREMENT',

        ORANGE:
            'ORANGE_MONEY',

        ORANGEMONEY:
            'ORANGE_MONEY',

        MTN:
            'MTN_MONEY',

        MTNMONEY:
            'MTN_MONEY',

        MOOV:
            'MOOV_MONEY',

        MOOVMONEY:
            'MOOV_MONEY',

        CARTE_BANCAIRE:
            'PAIEMENT_CARTE',

        CB:
            'PAIEMENT_CARTE',
    }

    return (
        aliases[
        normalized
        ] ??
        normalized
    )
}

function utcDay(
    value: Date,
) {
    return value
        .toISOString()
        .slice(
            0,
            10,
        )
}

function buildCandidates(
    moyenPaiement:
        string | null,

    caisses:
        Array<{
            id: string
            nom: string
            type: string

            institution:
            string | null

            active: boolean

            moyensOperation:
            string[]
        }>,
): Candidate[] {
    const moyen =
        normalizeMoyen(
            moyenPaiement,
        )

    const mobileMeans =
        new Set([
            'WAVE',
            'ORANGE_MONEY',
            'MTN_MONEY',
            'MOOV_MONEY',
            'MOBILE_MONEY',
        ])

    const bankingMeans =
        new Set([
            'VIREMENT',
            'CHEQUE',
        ])

    const cardMeans =
        new Set([
            'PAIEMENT_CARTE',
            'CARTE',
        ])

    return caisses
        .filter(
            (
                caisse,
            ) =>
                caisse.active,
        )
        .map(
            (
                caisse,
            ) => {
                const allowed =
                    caisse
                        .moyensOperation
                        .map(
                            normalizeMoyen,
                        )

                const searchable =
                    normalizeText(
                        [
                            caisse.nom,
                            caisse.institution,
                        ]
                            .filter(
                                Boolean,
                            )
                            .join(
                                ' ',
                            ),
                    )

                let score =
                    0

                const reasons:
                    string[] = []

                if (
                    moyen &&
                    allowed.includes(
                        moyen,
                    )
                ) {
                    score +=
                        100

                    reasons.push(
                        'moyen explicitement autorisé',
                    )
                }

                if (
                    bankingMeans.has(
                        moyen,
                    ) &&
                    (
                        caisse.type ===
                        'BANCAIRE' ||
                        caisse.type ===
                        'EPARGNE'
                    )
                ) {
                    score +=
                        70

                    reasons.push(
                        'type de compte bancaire compatible',
                    )
                }

                if (
                    moyen ===
                    'ESPECES' &&
                    caisse.type ===
                    'ESPECES'
                ) {
                    score +=
                        100

                    reasons.push(
                        'compte espèces',
                    )
                }

                if (
                    cardMeans.has(
                        moyen,
                    ) &&
                    caisse.type ===
                    'CARTE_BANCAIRE'
                ) {
                    score +=
                        80

                    reasons.push(
                        'compte carte compatible',
                    )
                }

                if (
                    mobileMeans.has(
                        moyen,
                    ) &&
                    caisse.type ===
                    'MOBILE_MONEY'
                ) {
                    score +=
                        45

                    reasons.push(
                        'compte mobile money',
                    )

                    if (
                        allowed.includes(
                            'MOBILE_MONEY',
                        )
                    ) {
                        score +=
                            15

                        reasons.push(
                            'ancien moyen MOBILE_MONEY autorisé',
                        )
                    }

                    const brand =
                        moyen.replace(
                            /_MONEY$/,
                            '',
                        )

                    if (
                        brand !==
                        'MOBILE' &&
                        searchable.includes(
                            brand,
                        )
                    ) {
                        score +=
                            60

                        reasons.push(
                            `nom du compte correspond à ${brand}`,
                        )
                    }
                }

                if (!moyen) {
                    score =
                        0

                    reasons.push(
                        'moyen de paiement absent : choix manuel obligatoire',
                    )
                }

                return {
                    caisseId:
                        caisse.id,

                    nom:
                        caisse.nom,

                    type:
                        caisse.type,

                    active:
                        caisse.active,

                    moyensOperation:
                        caisse.moyensOperation,

                    score,

                    raison:
                        reasons.join(
                            ' ; ',
                        ) ||
                        'aucune correspondance automatique',
                }
            },
        )
        .filter(
            (
                candidate,
            ) =>
                candidate.score >
                0,
        )
        .sort(
            (
                a,
                b,
            ) =>
                b.score -
                a.score,
        )
}

function formatFcfa(
    value: number,
) {
    return `${value.toLocaleString(
        'fr-FR',
        {
            maximumFractionDigits:
                2,
        },
    )} F CFA`
}

async function main() {
    const from =
        parseDateStart(
            parseArg(
                'from',
            ),
        )

    const to =
        parseDateEnd(
            parseArg(
                'to',
            ),
        )

    if (
        from &&
        to &&
        from > to
    ) {
        throw new Error(
            '--from doit être antérieur ou égal à --to.',
        )
    }

    const dateWhere =
        from || to
            ? {
                ...(from
                    ? {
                        gte:
                            from,
                    }
                    : {}),

                ...(to
                    ? {
                        lte:
                            to,
                    }
                    : {}),
            }
            : undefined

    console.log(
        '\n==================================================',
    )

    console.log(
        ' VELARIUM — DRY-RUN MIGRATION FINANCIÈRE',
    )

    console.log(
        ' AUCUNE ÉCRITURE EN BASE NE SERA EFFECTUÉE',
    )

    console.log(
        '==================================================\n',
    )

    console.log({
        from:
            from?.toISOString() ??
            'début de l’historique',

        to:
            to?.toISOString() ??
            'maintenant',
    })

    const [
        caisses,
        paiements,
        provisions,
        fraisPayes,
    ] =
        await Promise.all([
            prisma.caisse.findMany({
                orderBy: {
                    createdAt:
                        'asc',
                },

                select: {
                    id:
                        true,

                    nom:
                        true,

                    type:
                        true,

                    institution:
                        true,

                    active:
                        true,

                    moyensOperation:
                        true,

                    soldeInitial:
                        true,
                },
            }),

            prisma.paiement.findMany({
                where: {
                    mouvementFinanceId:
                        null,

                    ...(dateWhere
                        ? {
                            datePaiement:
                                dateWhere,
                        }
                        : {}),
                },

                orderBy: {
                    datePaiement:
                        'asc',
                },

                select: {
                    id:
                        true,

                    montant:
                        true,

                    datePaiement:
                        true,

                    moyenPaiement:
                        true,

                    facture: {
                        select: {
                            numero:
                                true,

                            dossier: {
                                select: {
                                    reference:
                                        true,
                                },
                            },
                        },
                    },
                },
            }),

            prisma.provision.findMany({
                where: {
                    mouvementFinanceId:
                        null,

                    ...(dateWhere
                        ? {
                            datePaiement:
                                dateWhere,
                        }
                        : {}),
                },

                orderBy: {
                    datePaiement:
                        'asc',
                },

                select: {
                    id:
                        true,

                    montant:
                        true,

                    datePaiement:
                        true,

                    moyenPaiement:
                        true,

                    factureId:
                        true,

                    dossier: {
                        select: {
                            reference:
                                true,
                        },
                    },
                },
            }),

            prisma.fraisOuvertureDossier.findMany({
                where: {
                    statut:
                        'PAYE',

                    mouvementFinanceId:
                        null,

                    ...(dateWhere
                        ? {
                            datePaiement:
                                dateWhere,
                        }
                        : {}),
                },

                orderBy: {
                    datePaiement:
                        'asc',
                },

                select: {
                    id:
                        true,

                    montant:
                        true,

                    datePaiement:
                        true,

                    factureId:
                        true,

                    dossier: {
                        select: {
                            reference:
                                true,
                        },
                    },
                },
            }),
        ])

    console.log(
        '\n===== COMPTES DISPONIBLES =====',
    )

    console.table(
        caisses.map(
            (
                caisse,
            ) => ({
                id:
                    caisse.id,

                nom:
                    caisse.nom,

                type:
                    caisse.type,

                active:
                    caisse.active,

                moyens:
                    caisse
                        .moyensOperation
                        .join(
                            ', ',
                        ),

                soldeInitial:
                    money(
                        caisse.soldeInitial,
                    ),
            }),
        ),
    )

    const baseItems:
        Array<{
            kind:
            | 'PAIEMENT'
            | 'PROVISION'

            id:
            string

            date:
            Date

            montant:
            number

            dossier:
            string | null

            facture:
            string | null

            moyenPaiement:
            string | null
        }> = [
            ...paiements.map(
                (
                    paiement,
                ) => ({
                    kind:
                        'PAIEMENT' as const,

                    id:
                        paiement.id,

                    date:
                        paiement.datePaiement,

                    montant:
                        money(
                            paiement.montant,
                        ),

                    dossier:
                        paiement
                            .facture
                            .dossier
                            .reference,

                    facture:
                        paiement
                            .facture
                            .numero,

                    moyenPaiement:
                        paiement
                            .moyenPaiement,
                }),
            ),

            ...provisions.map(
                (
                    provision,
                ) => ({
                    kind:
                        'PROVISION' as const,

                    id:
                        provision.id,

                    date:
                        provision.datePaiement,

                    montant:
                        money(
                            provision.montant,
                        ),

                    dossier:
                        provision
                            .dossier
                            .reference,

                    facture:
                        provision.factureId,

                    moyenPaiement:
                        provision
                            .moyenPaiement,
                }),
            ),
        ]

    const groups =
        new Map<
            string,
            typeof baseItems
        >()

    for (
        const item
        of baseItems
    ) {
        const identity =
            item.kind ===
                'PAIEMENT'
                ? item.facture
                : item.dossier

        const key = [
            item.kind,
            identity ??
            'SANS_REFERENCE',
            utcDay(
                item.date,
            ),
            item.montant,
        ].join(
            '|',
        )

        const group =
            groups.get(
                key,
            ) ??
            []

        group.push(
            item,
        )

        groups.set(
            key,
            group,
        )
    }

    const duplicateKeys =
        new Set(
            Array.from(
                groups.entries(),
            )
                .filter(
                    (
                        [
                            ,
                            items,
                        ],
                    ) =>
                        items.length >
                        1,
                )
                .map(
                    (
                        [
                            key,
                        ],
                    ) =>
                        key,
                ),
        )

    const items:
        MigrationItem[] =
        baseItems.map(
            (
                item,
            ) => {
                const identity =
                    item.kind ===
                        'PAIEMENT'
                        ? item.facture
                        : item.dossier

                const duplicateKey = [
                    item.kind,
                    identity ??
                    'SANS_REFERENCE',
                    utcDay(
                        item.date,
                    ),
                    item.montant,
                ].join(
                    '|',
                )

                const isDuplicate =
                    duplicateKeys.has(
                        duplicateKey,
                    )

                const candidates =
                    buildCandidates(
                        item.moyenPaiement,
                        caisses,
                    )

                return {
                    kind:
                        item.kind,

                    id:
                        item.id,

                    date:
                        item.date
                            .toISOString(),

                    montant:
                        item.montant,

                    dossier:
                        item.dossier,

                    facture:
                        item.facture,

                    moyenPaiement:
                        item.moyenPaiement,

                    duplicateGroup:
                        isDuplicate
                            ? duplicateKey
                            : null,

                    candidates,

                    selectedCaisseId:
                        '',

                    migrate:
                        false,

                    note:
                        isDuplicate
                            ? 'À vérifier : plusieurs lignes ont la même référence/date/montant.'
                            : candidates.length ===
                                1
                                ? 'Un candidat existe, mais il doit être validé manuellement.'
                                : candidates.length >
                                    1
                                    ? 'Plusieurs comptes candidats : choix manuel obligatoire.'
                                    : 'Aucun compte fiable détecté : choix manuel obligatoire.',
                }
            },
        )

    const totalPaiements =
        paiements.reduce(
            (
                sum,
                row,
            ) =>
                sum +
                money(
                    row.montant,
                ),
            0,
        )

    const totalProvisions =
        provisions.reduce(
            (
                sum,
                row,
            ) =>
                sum +
                money(
                    row.montant,
                ),
            0,
        )

    const totalFrais =
        fraisPayes.reduce(
            (
                sum,
                row,
            ) =>
                sum +
                money(
                    row.montant,
                ),
            0,
        )

    console.log(
        '\n===== RÉSUMÉ =====',
    )

    console.log({
        paiementsSansMouvement:
            paiements.length,

        montantPaiements:
            formatFcfa(
                totalPaiements,
            ),

        provisionsSansMouvement:
            provisions.length,

        montantProvisions:
            formatFcfa(
                totalProvisions,
            ),

        totalPotentielAMigrer:
            formatFcfa(
                totalPaiements +
                totalProvisions,
            ),

        fraisOuvertureSansMouvementExclus:
            fraisPayes.length,

        montantFraisExclus:
            formatFcfa(
                totalFrais,
            ),

        groupesDoublonsASurveiller:
            duplicateKeys.size,
    })

    console.log(
        '\n===== OPÉRATIONS À ANALYSER =====',
    )

    console.table(
        items.map(
            (
                item,
            ) => ({
                type:
                    item.kind,

                id:
                    item.id,

                date:
                    item.date.slice(
                        0,
                        10,
                    ),

                montant:
                    item.montant,

                dossier:
                    item.dossier,

                facture:
                    item.facture,

                moyen:
                    item.moyenPaiement,

                doublonPossible:
                    Boolean(
                        item.duplicateGroup,
                    ),

                candidats:
                    item.candidates
                        .slice(
                            0,
                            3,
                        )
                        .map(
                            (
                                candidate,
                            ) =>
                                `${candidate.nom} (${candidate.score})`,
                        )
                        .join(
                            ' | ',
                        ),
            }),
        ),
    )

    if (
        duplicateKeys.size >
        0
    ) {
        console.log(
            '\n===== GROUPES DE DOUBLONS POTENTIELS =====',
        )

        for (
            const key
            of duplicateKeys
        ) {
            console.log(
                `\n${key}`,
            )

            console.table(
                (
                    groups.get(
                        key,
                    ) ??
                    []
                ).map(
                    (
                        item,
                    ) => ({
                        id:
                            item.id,

                        type:
                            item.kind,

                        date:
                            item.date,

                        montant:
                            item.montant,

                        dossier:
                            item.dossier,

                        facture:
                            item.facture,

                        moyen:
                            item.moyenPaiement,
                    }),
                ),
            )
        }
    }

    console.log(
        '\n===== FRAIS D’OUVERTURE EXCLUS DE LA MIGRATION AUTOMATIQUE =====',
    )

    console.table(
        fraisPayes.map(
            (
                frais,
            ) => ({
                id:
                    frais.id,

                date:
                    frais.datePaiement,

                dossier:
                    frais
                        .dossier
                        .reference,

                factureId:
                    frais.factureId,

                montant:
                    money(
                        frais.montant,
                    ),

                raison:
                    'À contrôler séparément pour éviter un double encaissement.',
            }),
        ),
    )

    const outputPath =
        path.resolve(
            process.cwd(),
            'finance-migration-plan.json',
        )

    const plan = {
        generatedAt:
            new Date()
                .toISOString(),

        dryRun:
            true,

        period: {
            from:
                from?.toISOString() ??
                null,

            to:
                to?.toISOString() ??
                null,
        },

        warning:
            'CE FICHIER EST UN PLAN. AUCUNE MIGRATION NE DOIT ÊTRE EXÉCUTÉE TANT QUE selectedCaisseId et migrate n’ont pas été validés ligne par ligne.',

        migrationUserId:
            '',

        totals: {
            payments:
                totalPaiements,

            provisions:
                totalProvisions,

            potentialMigrationTotal:
                totalPaiements +
                totalProvisions,

            excludedOpeningFees:
                totalFrais,
        },

        accounts:
            caisses.map(
                (
                    caisse,
                ) => ({
                    id:
                        caisse.id,

                    nom:
                        caisse.nom,

                    type:
                        caisse.type,

                    active:
                        caisse.active,

                    moyensOperation:
                        caisse
                            .moyensOperation,
                }),
            ),

        items,

        excludedOpeningFees:
            fraisPayes.map(
                (
                    frais,
                ) => ({
                    id:
                        frais.id,

                    dossier:
                        frais
                            .dossier
                            .reference,

                    factureId:
                        frais.factureId,

                    date:
                        frais
                            .datePaiement
                            ?.toISOString() ??
                        null,

                    montant:
                        money(
                            frais.montant,
                        ),

                    migrate:
                        false,

                    note:
                        'Exclu du plan automatique : vérifier si le règlement de facture porte déjà l’encaissement.',
                }),
            ),
    }

    fs.writeFileSync(
        outputPath,
        JSON.stringify(
            plan,
            null,
            2,
        ),
        'utf8',
    )

    console.log(
        '\nPlan généré :',
        outputPath,
    )

    console.log(
        '\nAUCUNE DONNÉE POSTGRESQL N’A ÉTÉ MODIFIÉE.',
    )
}

main()
    .catch(
        (
            error,
        ) => {
            console.error(
                '\nDRY-RUN ÉCHOUÉ :',
                error,
            )

            process.exitCode =
                1
        },
    )
    .finally(
        async () => {
            await prisma
                .$disconnect()
        },
    )
