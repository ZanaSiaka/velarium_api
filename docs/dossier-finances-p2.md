# Dossier — consolidation financière P2

Livraison du 12 novembre 2026. Périmètre : onglet Finances uniquement, avec réutilisation du module Finance. Les modifications locales P0, P1 et P1.1 ont été conservées.

## Décision sur les catégories

Le cabinet a demandé de **conserver uniquement les catégories existantes pour le moment**. `MouvementFinance.categorie` et l’enum `CategorieFinance` sont réutilisés. `TRANSPORT` correspond à Transport et déplacement ; `AUTRE` à Autres dépenses. La description précise la nature exacte pour une nouvelle SORTIE de dossier classée AUTRE, avec validation backend.

Les catégories existantes ACHAT, FOURNITURES, etc. restent disponibles selon leur sens actuel. Aucun rapprochement artificiel entre frais de justice et impôts, ou entre honoraires de tiers et honoraires du cabinet, n’est effectué. Les huit catégories spécialisées absentes sont différées. Aucun changement Prisma ni migration n’est nécessaire pour le périmètre retenu ; aucun n’a été créé ou exécuté.

`source` et `sourceLibelle` conservent leur fonction d’origine du mouvement. Ils ne servent pas de référentiel de remplacement des catégories. Le formulaire expose ces champs déjà requis par le backend, auparavant absents du contrat de création frontend.

## Fichiers de cette intervention

Backend, chemins relatifs à velarium_api :

- `src/common/finance/financial-read.ts` : calculs décimaux et lecture commune des provisions.
- `src/modules/dossiers/dossier-finance-read.ts` : contrat consolidé, devises, reçus et avertissements.
- `src/modules/dossiers/dossiers.service.ts` : requête enrichie et intégration de la consolidation en lecture.
- `src/modules/dossiers/dossiers.controller.ts` : transmission du rôle au livre et réponse privée sans cache.
- `src/modules/dossiers/dossiers-opening-payment.spec.ts` : appel de lecture historique adapté au contrôle financier ; test non exécuté.
- `src/modules/provisions/provisions.service.ts` : calcul de lecture partagé, sans changement des mutations.
- `src/modules/finance/finance.controller.ts` : filtres catégorie et demande explicite de totaux.
- `src/modules/finance/finance.service.ts` : montants exacts, devise, totaux filtrés par devise, persistance et validation du moyen de paiement optionnel, description des autres dépenses de dossier.
- `src/modules/finance/dto/create-mouvement.dto.ts` : moyen de paiement optionnel typé avec l’enum existant.
- `docs/dossier-finances-p2.md` : présent rapport.

Frontend, chemins relatifs à velarium_front :

- `src/lib/dossier-finance.ts` : types et affichage des décimaux exacts, dates et libellés des catégories existantes.
- `src/app/(layout-pages)/honoraires/actions.ts` : types des lectures consolidées.
- `src/app/(layout-pages)/finance/actions.ts` : lecture des dépenses filtrées et alignement des champs de création.
- `src/app/(layout-pages)/dossiers/[id]/DossierSecondarySections.tsx` : orchestration autorisée, factures et provisions, actions existantes et états d’erreur.
- `src/app/(layout-pages)/dossiers/[id]/LivrePaiements.tsx` : synthèse, paiements et frais d’ouverture, liens et reçus existants.
- `src/app/(layout-pages)/dossiers/[id]/DossierExpenses.tsx` : dépenses, filtres, totaux et accès au formulaire et aux justificatifs existants.
- `src/components/finance/MouvementDialog.tsx` : mode dépense avec SORTIE et dossier préremplis/verrouillés ; origine et moyens autorisés du compte.

Les autres fichiers apparaissant dans git status étaient déjà modifiés avant cette intervention. Ils ne constituent pas des changements P2 supplémentaires.

## Modèles et endpoints réutilisés

Modèles : Dossier, Facture, Paiement, Provision, ImputationProvision, FraisOuvertureDossier, MouvementFinance, Caisse, RecuEncaissement et PieceJointeFinance. Aucun second système financier.

- `GET /api/finance/permissions` : capacités backend existantes.
- `GET /api/dossiers/:id/livre-paiements` : ajout de `consolidation.version = 2`, avec montants décimaux sous forme de chaînes ou null. L’enveloppe numérique historique et les types d’opérations historiques restent présents ; un montant indisponible peut désormais être null.
- `GET /api/factures?dossierId=...` : liste du dossier, liens vers la consultation et les actions de facturation existantes.
- `GET /api/provisions?dossierId=...` : lecture individuelle harmonisée avec `lectureFinanciere` ; le dossier utilise la consolidation commune pour son affichage.
- `GET /api/finance/mouvements?dossierId=...&type=SORTIE&categorie=...&dateDebut=...&dateFin=...&avecTotaux=true` : résultat `{items, totauxParDevise, sansDevise}`. Sans `avecTotaux=true`, le format tableau historique reste inchangé. Une seule lecture des mouvements filtrés ; pas de requête par ligne.
- `POST /api/finance/mouvements` : même création de SORTIE, permissions, comptes actifs, source et contrôle du solde existants. Moyen optionnel accepté et contrôlé selon la configuration du compte ; obligatoire dans le formulaire de dépense du dossier.
- Endpoints existants `/api/finance/mouvements/:mouvementId/pieces-jointes/...` et module Reçus : composants `FinanceAttachmentsDialog` et `RecuActions` réutilisés. Aucun changement du stockage R2 ni génération rétroactive de reçu.

Le justificatif est joint après l’enregistrement depuis la liste, via le mécanisme existant. Son échec éventuel ne déclenche pas une seconde création du mouvement. Le champ historique `pieceJointe` ne fait pas l’objet d’une nouvelle interprétation ou d’une ouverture automatique d’URL ; le dialogue réutilisé expose les relations PieceJointeFinance.

## Calculs avant et après

Avant : sommes en Number, calculs de remplacement côté frontend, arrondis d’affichage à l’entier, différences entre provisions individuelles et livre, paiements présentés systématiquement sans reçu, absence de devise dans la projection des mouvements.

Après : calculs communs avec Decimal, restitution exacte à deux décimales, null distinct de zéro, affichage sans somme monétaire frontend ni conversion implicite. Les anciens champs numériques du livre servent à la compatibilité ; la fiche utilise le contrat versionné exact. Les conversions numériques nécessaires au formulaire d’imputation existant sont limitées aux montants représentables en centimes sûrs, sans recalculer un solde absent.

- Provisions reçues : montants initiaux, distincts des sommes affectées aux factures.
- Provision historique avec factureId seul : montant initial entièrement affecté, conformément au mécanisme antérieur.
- Provision avec imputations seules : somme des imputations ; disponible = maximum entre initial moins imputé et zéro.
- factureId et imputations coexistants : aucune priorité ni addition arbitraire ; imputé/disponible indisponibles et avertissement. Les cas négatifs ou dépassant le principal sont également signalés.
- Facture réglée : paiements et affectations de provisions identifiées ; une imputation n’est pas un nouvel encaissement.
- Encaissement : paiements et provisions reçues ; encaissement global avec frais d’ouverture payés, uniquement lorsque les données sont réconciliables.
- Reste global et trop-perçu : formules nettes historiques conservées. Aucune nouvelle règle de refacturation, imputation ou affectation des trop-perçus.
- Un même mouvement référencé dans plusieurs écritures métier rend les agrégats concernés indisponibles. Une ancienne facture de frais d’ouverture déjà réglée/non réconciliée provoque un avertissement et bloque le total global potentiellement doublonné.
- Reçus : uniquement les relations réelles via MouvementFinance, avec vérification du dossier du reçu ; aucun rapprochement par montant ou date.
- Dépenses : total séparé par devise, après filtres backend ; aucun ajout au reste à payer des factures et aucune assimilation à une facture client.

Le périmètre historique des factures est conservé : tous les statuts, y compris BROUILLON. La présence de brouillons est signalée. Leur exclusion nécessite une décision métier ; aucun statut annulé n’existe dans l’enum actuel.

La facturation/paiement existante utilise XOF ; Facture ne possède pas de colonne devise. La devise des mouvements provient du compte existant. Les encaissements historiques sans mouvement/devise connue, ou dans une devise différente, ne sont pas additionnés aux agrégats XOF. Aucune conversion ni modification monétaire n’a été introduite.

## Permissions et points séparés

Les données de la fiche ne sont chargées qu’après contrôle des capacités financières backend. La lecture du livre est maintenant vérifiée dans le service avec FinancePermissionService. Les listes de mouvements et les justificatifs conservent leurs contrôles backend. La création de dépense utilise canCreateMouvement, sans nouveau rôle. Les comptes sont chargés seulement avec les capacités nécessaires.

La politique de rôle des routes Provisions reste un point préexistant à arbitrer : `GET /provisions`, `POST /provisions`, `POST /provisions/:id/imputations`, `DELETE /provisions/:id/imputations/:imputationId`. Leur contrôleur n’exprime pas une politique financière complète ; les mutations ne sont pas sécurisées par le seul masquage frontend. Aucune matrice arbitraire ni changement des mutations n’a été appliqué dans cette livraison.

ConventionHonoraires : modèle lié au dossier avec montantForfaitaire, tauxHoraire, conditions et dates techniques. Aucun service, contrôleur ou composant fonctionnel identifié dans les sources inspectées. Intervention séparée recommandée pour une lecture autorisée. La présence réelle de données n’a pas été vérifiée en base. Aucun module de conventions ni devis ajouté.

## Vérification

- TypeScript backend production : `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit --incremental false` — réussi.
- TypeScript frontend : `node node_modules/typescript/bin/tsc --noEmit --incremental false` — réussi.
- `git diff --check` backend — réussi. Frontend : réussi avant le dernier ajout d’affichage de la date et du moyen de paiement des frais d’ouverture ; la dernière relance a été refusée lors de l’autorisation et n’a pas été contournée. Contrôle complémentaire préalable des espaces et fins de ligne des fichiers nouveaux/locaux réussi. Le dernier état frontend n’est donc pas déclaré revérifié par cette commande.
- Test d’ouverture historique adapté à l’argument de rôle ; aucune exécution Jest ni suite automatisée, conformément à la consigne.
- Contrôle backend limité à la configuration de production, qui exclut les specs. Le contrôle global incluant les fichiers de test n’est pas validé dans cette livraison.
- Aucune validation fonctionnelle en conditions réelles, aucun démarrage de serveur, aucune écriture PostgreSQL/R2, aucune installation npm, migration, commit ou push.

Les vérifications statiques ne prouvent pas une absence de régression en conditions réelles. À vérifier manuellement sur un environnement de validation : rôles autorisés/refusés, dossier sans finance, zéro réel et montant inconnu, provisions historiques/explicites/ambiguës, références de mouvement dupliquées, factures brouillon, reçus existants, dépenses Transport/Autres avec description, refus d’un moyen non configuré, filtres dates/catégorie, comptes de devises différentes et justificatifs selon les capacités. Déployer les contrats backend et frontend correspondants ensemble. La concurrence des écritures et les règles de solde du module Finance n’ont pas été refondues.
