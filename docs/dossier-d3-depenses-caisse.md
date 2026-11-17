# D3 — Dépenses de dossier depuis la caisse physique

> Document historique D3. Les décisions de caisse physique imposée et de formulaire à quatre champs sont remplacées par F2.1 : sélection explicite d'un compte actif en XOF, formulaire à cinq champs, aucune dépendance à DOSSIER_EXPENSE_CAISSE_ID. Voir finance-f2.1-comptes-depenses.md. Ne pas configurer une caisse de référence sur la base des instructions historiques ci-dessous.

## État

Implémentation préparée. Activation en attente de l'identifiant de caisse que le cabinet fournira. Le contrôle PostgreSQL READ ONLY a trouvé zéro caisse ESPECES dans la base configurée ; aucune caisse n'a été créée ou requalifiée, aucune configuration de référence n'a été écrite.

## Mécanisme

- POST `/api/finance/dossiers/:dossierId/depenses`, authentifié et soumis aux permissions financières existantes. L'utilisateur et son rôle actif sont revérifiés en transaction.
- Corps limité à categorie, motif, montant positif et date. En-tête Idempotency-Key UUID v4 obligatoire.
- Référence explicite via DOSSIER_EXPENSE_CAISSE_ID. La caisse doit exister, être active, de type ESPECES et en XOF. Aucun choix de première caisse ni création automatique. Configuration absente ou incompatible : refus HTTP 409.
- Le service Finance existant crée un seul MouvementFinance SORTIE, en espèces, lié au dossier et à l'auteur authentifié. Le mouvement et sa journalisation utilisent la même transaction Serializable. Les conflits de sérialisation sont réessayés de manière bornée.
- La clé de demande détermine l'identifiant unique du mouvement ; le rejeu identique retourne son identifiant, un contenu différent produit un 409. Cette protection concerne la nouvelle route, pas toute création historique par la route Finance générale.
- Le contrôle de solde insuffisant existant est conservé. Le calcul existant reste solde initial + entrées - sorties. Aucune seconde écriture ni nouveau solde parallèle.
- Les créations manuelles SORTIE avec dossier sur l'ancienne route doivent également respecter la caisse physique, les espèces, les six catégories et un motif/date renseignés. Les autres mouvements ne sont pas refondus.

## Interface

Réutilisation de MouvementDialog, branche Dossier limitée à quatre champs : nature, motif, montant FCFA et date. Catégories : Transport, Restauration, Communication, Fournitures, Impression et photocopie, Autres. Le motif est obligatoire pour toutes, donc aussi Autres.

Le formulaire Finance général conserve son interface. Les dépenses historiques, filtres, justificatifs et totaux par devise restent consultables. Les comptes restent disponibles pour le formulaire de provision existant.

## Fichiers D3

Backend : src/modules/finance/finance.controller.ts ; src/modules/finance/finance.service.ts ; src/modules/finance/dto/create-dossier-expense.dto.ts ; src/modules/activity-log/activity-log.service.ts (client transactionnel optionnel pour log).

Frontend : src/app/(layout-pages)/finance/actions.ts ; src/components/finance/MouvementDialog.tsx ; src/app/(layout-pages)/dossiers/[id]/DossierExpenses.tsx ; src/app/(layout-pages)/dossiers/[id]/DossierSecondarySections.tsx.

Ce rapport s'ajoute aux modifications locales D1/D2 préexistantes, préservées.

## Validation et limites

TypeScript backend de production : réussi (`node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit --incremental false`). Une erreur initiale de typage du contrôle des catégories a été corrigée avant ce résultat.

TypeScript frontend : réussi (`node node_modules/typescript/bin/tsc --noEmit --incremental false`). Git diff --check : réussi dans les deux projets ; avertissements LF/CRLF seulement côté frontend.

Pas de Jest, d'opération financière réelle, de migration, de modification PostgreSQL/R2, de commit ou de push. Aucune modification des provisions, honoraires ou factures. L'exemple 500000 - 5000 = 495000 correspond au calcul statique conservé, pas à une opération exécutée.

Les scénarios réels de paiement, permissions, solde insuffisant, rejeu et concurrence restent à vérifier sur des données de test après configuration d'une caisse valide. Les écritures Finance hors D3 n'ont pas fait l'objet d'une refonte globale de concurrence.

Aucune migration nécessaire pour D3. Ne pas activer tant que la caisse fournie n'a pas été vérifiée (existence, type, activité, devise et moyens autorisés).
