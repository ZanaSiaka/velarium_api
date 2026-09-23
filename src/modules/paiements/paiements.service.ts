import {
    Injectable,
} from '@nestjs/common';

import {
    PrismaService,
} from '../../prisma/prisma.service';

@Injectable()
export class PaiementsService {
    constructor(
        private readonly prisma:
            PrismaService,
    ) { }

    async findAll() {
        const [
            paiements,
            provisions,
        ] =
            await Promise.all([
                this.prisma.paiement.findMany({
                    orderBy: {
                        datePaiement:
                            'desc',
                    },

                    include: {
                        facture: {
                            include: {
                                client:
                                    true,

                                dossier:
                                    true,
                            },
                        },

                        mouvementFinance: {
                            include: {
                                caisse: {
                                    select: {
                                        id:
                                            true,

                                        nom:
                                            true,

                                        type:
                                            true,

                                        institution:
                                            true,

                                        identifiant:
                                            true,

                                        titulaire:
                                            true,
                                    },
                                },
                            },
                        },
                    },
                }),

                this.prisma.provision.findMany({
                    orderBy: {
                        datePaiement:
                            'desc',
                    },

                    include: {
                        dossier: {
                            include: {
                                client:
                                    true,
                            },
                        },

                        facture:
                            true,

                        mouvementFinance: {
                            include: {
                                caisse: {
                                    select: {
                                        id:
                                            true,

                                        nom:
                                            true,

                                        type:
                                            true,

                                        institution:
                                            true,

                                        identifiant:
                                            true,

                                        titulaire:
                                            true,
                                    },
                                },
                            },
                        },
                    },
                }),
            ]);

        const paiementsNormalises =
            paiements.map(
                (paiement) => ({
                    id:
                        paiement.id,

                    type:
                        'PAIEMENT' as const,

                    date:
                        paiement.datePaiement,

                    montant:
                        Number(
                            paiement.montant,
                        ),

                    moyenPaiement:
                        paiement.moyenPaiement,

                    note:
                        paiement.note,

                    client: {
                        id:
                            paiement.facture
                                .client.id,

                        nom:
                            paiement.facture
                                .client.nom,
                    },

                    dossier: {
                        id:
                            paiement.facture
                                .dossier.id,

                        reference:
                            paiement.facture
                                .dossier.reference,
                    },

                    facture: {
                        id:
                            paiement.facture.id,

                        numero:
                            paiement.facture
                                .numero,
                    },

                    mouvementFinance:
                        paiement.mouvementFinance
                            ? {
                                id:
                                    paiement
                                        .mouvementFinance
                                        .id,

                                source:
                                    paiement
                                        .mouvementFinance
                                        .source,

                                reference:
                                    paiement
                                        .mouvementFinance
                                        .reference,

                                compte:
                                    paiement
                                        .mouvementFinance
                                        .caisse,
                            }
                            : null,
                }),
            );

        const provisionsNormalisees =
            provisions.map(
                (provision) => ({
                    id:
                        provision.id,

                    type:
                        'PROVISION' as const,

                    date:
                        provision.datePaiement,

                    montant:
                        Number(
                            provision.montant,
                        ),

                    moyenPaiement:
                        provision.moyenPaiement,

                    note:
                        provision.note,

                    client: {
                        id:
                            provision.dossier
                                .client.id,

                        nom:
                            provision.dossier
                                .client.nom,
                    },

                    dossier: {
                        id:
                            provision.dossier.id,

                        reference:
                            provision.dossier
                                .reference,
                    },

                    facture:
                        provision.facture
                            ? {
                                id:
                                    provision
                                        .facture.id,

                                numero:
                                    provision
                                        .facture.numero,
                            }
                            : null,

                    mouvementFinance:
                        provision.mouvementFinance
                            ? {
                                id:
                                    provision
                                        .mouvementFinance
                                        .id,

                                source:
                                    provision
                                        .mouvementFinance
                                        .source,

                                reference:
                                    provision
                                        .mouvementFinance
                                        .reference,

                                compte:
                                    provision
                                        .mouvementFinance
                                        .caisse,
                            }
                            : null,
                }),
            );

        return [
            ...paiementsNormalises,
            ...provisionsNormalisees,
        ].sort(
            (a, b) =>
                new Date(
                    b.date,
                ).getTime() -
                new Date(
                    a.date,
                ).getTime(),
        );
    }
}