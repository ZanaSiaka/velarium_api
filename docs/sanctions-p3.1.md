# Velarium P3.1 — suivi des sanctions, backend

## Etat et périmètre

Implémentation backend uniquement. Pas de frontend, migration exécutée, import réel, écriture Neon ou installation npm. Les modifications locales P0/P1/P2 préexistantes sont conservées. Le client Prisma 7.8.0 a été généré localement après autorisation.

**Ce document ne vaut pas activation en production.** La migration, les contraintes PostgreSQL et le stockage doivent encore faire l'objet d'une recette isolée puis d'une validation de déploiement.

## Architecture

Module `src/modules/sanctions`, chargé par AppModule. Authentification JWT et RolesGuard globaux existants; contrôleurs marqués AVOCAT et SanctionsGuard dédié. Chaque méthode métier relit en base l'utilisateur actif et AVOCAT, et les mutations le revérifient dans leur transaction Serializable. Aucun nouveau rôle.

Cinq modèles :

- **PersonneSuivie** : nature physique/morale, nom, identifiant typé, justification d'identité, vérificateur et date, auteur, version. Lien Client facultatif et explicite. Les homonymes restent des personnes distinctes. Un identifiant n'est pas déduit des données Client.
- **DossierPersonne** : lien explicite vers un dossier et qualité CLIENT/PARTIE_ADVERSE/AVOCAT_ADVERSE/REPRESENTANT/AUTRE. La qualité CLIENT exige un client explicitement lié correspondant au dossier. Aucun ancien texte juridique n'est converti.
- **SignalementSanction** : qualification indépendante de l'état de mesure, type, source, URL HTTPS facultative (jamais téléchargée par le serveur), description factuelle, autorité, référence, dates civiles, auteur, vérificateur, justificatif et version.
- **SanctionHistorique** : événements spécialisés avec auteur, motif, version, avant/après ou métadonnées de pièce. Append-only au service et avec triggers SQL interdisant UPDATE/DELETE/TRUNCATE. Aucun détail de sanction n'est placé dans ActivityLog.
- **SanctionPiece** : référence de source, clé opaque privée, MIME, taille, SHA-256, auteur et date. Pas de relation vers Document, pas d'URL persistée, aucune route de modification/suppression.

Enums : NaturePersonneSuivie (PHYSIQUE/MORALE), QualificationSanction (A_VERIFIER/CONFIRMEE/ECARTEE), EtatMesureSanction (NON_DETERMINE/A_VENIR/EN_VIGUEUR/SUSPENDUE/EXPIREE/LEVEE/ANNULEE), ActionSanction (CONFIRMER/ECARTER/REOUVRIR/MODIFIER_MESURE).

Index : recherches/tri des personnes, listes et historiques par personne/signalement avec date et identifiant, qualification/état, liens Dossier. Unicités : Client associé, dossier/personne/qualité, clé S3 et couple identifiant de pièce/signalement. La clé étrangère composite du justificatif impose son appartenance au même signalement.

Les nouvelles relations Client/Dossier/User sont uniquement inverses dans les modèles existants. Aucune nouvelle colonne sensible sur ces modèles : leurs réponses Prisma existantes n'incluent pas automatiquement les sanctions.

## Routes et contrôle d'accès

Préfixe global existant : /api. Toutes les routes ci-dessous exigent un JWT et un AVOCAT actif, même les compteurs, recherches, historiques et métadonnées. Réponses privées no-store. Aucun identifiant User ne permet d'obtenir ses secrets; les projections du module sont explicites.

| Méthode | Chemin sans /api | Fonction |
| --- | --- | --- |
| GET, POST | /personnes-suivies | Liste/recherche paginée, création |
| GET, PATCH | /personnes-suivies/:id | Détail, correction versionnée de l'identité |
| GET, POST | /personnes-suivies/:id/dossiers | Liens explicites paginés, ajout motivé |
| GET | /personnes-suivies/:id/historique | Historique de l'identité et de ses signalements |
| GET, POST | /personnes-suivies/:id/sanctions | Liste filtrée/paginée, création A_VERIFIER |
| GET, PATCH | /sanctions/:id | Détail, correction versionnée |
| POST | /sanctions/:id/transitions | Transition motivée |
| GET | /sanctions/:id/historique | Historique spécialisé paginé |
| GET, POST | /sanctions/:id/pieces | Métadonnées paginées, dépôt multipart |
| GET | /sanctions/:id/pieces/:pieceId/contenu | Téléchargement authentifié, attachment, nosniff, CSP sandbox |

Pagination : page 1..500, limit 1..100 (20 par défaut). Recherche de nom 2..120 caractères. Filtres de liste : qualification et etatMesure, sans tri/where arbitraire.

Les mutations exigent la version actuelle. Une version ancienne, un échec du compare-and-swap ou une sérialisation concurrente retourne 409. DTO validés aussi au service; les champs inconnus sont refusés. Les lectures convertissent les erreurs techniques en réponses neutres, sans requêtes SQL ou données personnelles.

## Règles de transition

La création impose A_VERIFIER / NON_DETERMINE. POST/PATCH général refuse qualification, état, auteur et vérificateur injectés.

- **CONFIRMER** : A_VERIFIER -> CONFIRMEE, état explicite autre que NON_DETERMINE.
- **ECARTER** : A_VERIFIER -> ECARTEE / NON_DETERMINE.
- **REOUVRIR** : ECARTEE -> A_VERIFIER / NON_DETERMINE.
- **MODIFIER_MESURE** : seulement si CONFIRMEE, selon la matrice ci-dessous, avec preuve vérifiée.

| Depuis | Vers autorisés |
| --- | --- |
| A_VENIR | EN_VIGUEUR, SUSPENDUE, EXPIREE, LEVEE, ANNULEE |
| EN_VIGUEUR | SUSPENDUE, EXPIREE, LEVEE, ANNULEE |
| SUSPENDUE | EN_VIGUEUR, EXPIREE, LEVEE, ANNULEE |
| EXPIREE | ANNULEE |
| LEVEE | ANNULEE |
| ANNULEE | Aucun |
| NON_DETERMINE | Aucun changement d'état isolé |

Une sanction confirmée ne redevient jamais A_VERIFIER automatiquement. Une nouvelle décision réactivant une mesure expirée/levée/annulée nécessite un nouveau signalement; pas de réactivation silencieuse.

Confirmation : identité explicitement établie (identifiant typé et justification, acteur et date), autorité, référence et date de décision applicables, justificatif rattaché dont les octets stockés correspondent au SHA-256 et à la taille. Si la date de décision est non applicable, il faut dateDecisionApplicable=false et un motifDateDecisionAbsente explicite; une date simplement inconnue ne satisfait pas cette exception. Le vérificateur est l'utilisateur courant, jamais une valeur du DTO.

Dates : YYYY-MM-DD valides, fin >= début, décision confirmée non future. A_VENIR exige un début futur; EN_VIGUEUR exige un début non futur et aucune fin passée; EXPIREE exige une fin passée. La transition peut fournir dateDebut/dateFin pour inscrire la fin lors d'une expiration. Une fin absente reste inconnue : aucun booléen de permanence.

PATCH : champs absents conservés; null accepté seulement pour les champs facultatifs; motif/version obligatoires. Une correction d'un signalement confirmé exige de nouveau un justificatif vérifiable et revalide l'état final. L'identité d'une personne ayant une sanction confirmée ne peut plus être modifiée par le PATCH ordinaire (409) : une procédure de rectification spécialisée reste à arbitrer.

Les mutations et leurs historiques, ainsi que les enregistrements de pièces, sont dans la même transaction Prisma. Aucun changement de KYC, Client.notes, partieAdverse, statut Dossier, Finance, facturation ou provisions.

## Procédure de justification

1. Créer la personne manuellement, sans rapprochement automatique. Fournir un identifiant réellement vérifié et sa justification, avec identiteEtablie=true, soit à la création soit via PATCH motivé.
2. Créer un signalement A_VERIFIER avec les faits et la provenance. Compléter l'autorité, la référence et les dates sans présumer une sanction confirmée.
3. Déposer la pièce sur POST /sanctions/:id/pieces : multipart `file`, `version`, `motif`, `referenceSource`. Le retour fournit `piece.id` et la nouvelle `version`.
4. Consulter la pièce par la route authentifiée et vérifier humainement l'identité et la décision. Le code vérifie intégrité et rattachement, pas la vérité juridique d'un document.
5. POST /sanctions/:id/transitions avec `version`, `action: CONFIRMER`, `etatMesure`, `justificatifId` et `motif`. L'utilisateur actif courant est enregistré comme vérificateur.
6. Toute évolution utilise une nouvelle transition motivée/probante ou une correction spécialisée, sans réécrire l'historique.

Pas de consultation automatique de registres externes ni d'exécution d'URL fournie. L'auteur peut être le vérificateur : aucun principe de double validation n'a été imposé dans les décisions métier.

## Confidentialité et stockage

Configurer **SANCTIONS_S3_BUCKET** vers un bucket privé dédié; aucune réutilisation implicite de S3_BUCKET. L'absence de cette configuration refuse les opérations de fichiers. La confidentialité du bucket doit être vérifiée sur le fournisseur avant activation (absence d'accès/listing public, droits IAM nécessaires, chiffrement et politique de conservation). Endpoint/région et identifiants S3 existants sont réutilisés, sans impression de leurs valeurs.

Objets `sanctions-private/v1/<uuid>`, sans nom de personne ni nom original du fichier. MIME autorisés PDF/PNG/JPEG, 5 Mio maximum, signature binaire vérifiée et lecture S3 réellement bornée même si ContentLength est trompeur. Aucun document n'est rendu inline et aucune URL S3 n'est émise. Le téléchargement relit l'autorisation après l'IO avant de retourner les octets.

Le S3Service générique refuse ce préfixe en upload, téléchargement, affichage et suppression. DocumentsService refuse le greffage de ces clés, exclut les métadonnées réservées des listes et refuse les consultations d'un éventuel enregistrement greffé. Cela protège aussi les appels génériques partageant S3Service, sans ajouter d'accès aux autres rôles.

S3 ne participe pas à PostgreSQL : upload/relecture avant la transaction de pièce. Sur conflit certain, suppression compensatoire du nouvel objet seulement. Sur résultat de commit inconnu ou indisponibilité, conservation de l'objet privé et réconciliation opérationnelle ultérieure, afin de ne pas supprimer une preuve possiblement enregistrée. Aucune suppression d'ancienne pièce.

Les signatures binaires ne constituent pas un antivirus ni une authentification officielle. Une analyse antivirus/quarantaine, si exigée par le cabinet, et une politique de conservation/purge restent à préparer. L'historique immuable n'est pas une garantie contre un administrateur PostgreSQL pouvant modifier ses triggers.

## Migration préparée, non exécutée

`prisma/migrations/20261028000000_add_sanctions/migration.sql` : transaction SQL, quatre enums, cinq nouvelles tables, index et FK RESTRICT, FK composite de preuve, CHECK de versions/dates/qualification/justification, tailles/types de pièces et triggers append-only. Pas de backfill, UPDATE/DELETE de données existantes ou suppression de colonne.

Une comparaison **locale** `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` a vérifié la présence des 35 instructions Prisma attendues dans le SQL préparé. Les CHECK et triggers additionnels sont intentionnels. Cette commande compare le schéma à un modèle vide, sans introspection d'une base et sans exécuter le SQL.

Commandes effectivement utilisées pour Prisma : validate, generate, et diff schéma-seul. Aucun migrate dev/deploy/reset, db push, seed, SQL DDL en base ou connexion métier aux nouvelles tables.

Avant activation : valider sauvegarde/branche Neon de recette; vérifier l'état des migrations P1/P2/P3; approuver puis tester la migration sur cette branche; tester FK composite, CHECK, immutabilité et concurrence réelle; configurer le bucket privé et IAM; recette avec avocats puis déploiement validé. Ne pas réinitialiser la base pour traiter une erreur.

## Arbitrages et limites

- Lien Client un-à-un facultatif pour cette première version : pas de fusion automatique de plusieurs fiches client en une identité. Cette limite est non destructive et pourra être étendue après arbitrage.
- Accès pour tous les AVOCAT actifs, conformément aux décisions validées; pas de confidentialité nominative entre avocats.
- Pas de suppression ou détachement des liens historiques; rectification d'identité déjà confirmée à concevoir explicitement.
- Pas de changement automatique des états à la date d'échéance : les transitions restent explicites; aucun traitement de fond métier n'est ajouté.
- La matrice de transitions est volontairement conservatrice et terminale pour ANNULEE. Les nouvelles décisions sont de nouveaux signalements.
- Les snapshots privés contiennent des données personnelles : rétention, purge encadrée et sauvegardes à valider avant production.
- Tests de transactions/concurrence simulés; aucune preuve d'intégration réelle PostgreSQL ou S3 à ce stade.
- Pas de frontend, ni de correctif npm de sécurité dans P3.1.

## Validation de cette intervention

- `prisma validate --config prisma.config.ts` : schéma valide.
- `prisma generate --config prisma.config.ts` : client **7.8.0** généré localement après autorisation, sans migration.
- `tsc --noEmit --incremental false` : réussi.
- `jest --runInBand --no-cache` : **15 suites, 370/370 tests réussis**. Répartition : 193 tests P0/P1/P2 préexistants, 177 tests P3.1.
- Les tests P3.1 couvrent tous les endpoints sans session, avec un rôle non autorisé ou un avocat inactif, ainsi que la matrice de 49 couples d'états, preuves, homonymes, liens explicites, PATCH/null, conflit de version, transactions simulées, intégrité S3, refus des accès génériques et absence de mutation des données historiques.
- Comparaison SQL locale schéma-seul : **35 instructions attendues, 0 manquante**; les CHECK et triggers supplémentaires restent à tester sur PostgreSQL isolé.
- `git diff --check` et contrôle des espaces finaux/marqueurs de conflit des nouveaux fichiers : réussis; avertissements LF/CRLF préexistants sur deux tests Auth.
- Avertissement non bloquant du SDK AWS : les versions publiées à partir de janvier 2027 demanderont Node >=22; environnement actuel Node 20.20.2. Aucune dépendance modifiée.
- `test/app.e2e-spec.ts` n'a pas été exécuté : ce scaffold initialise AppModule sans mocks et ne respecte pas l'exigence de recette exclusivement simulée. Les contrôleurs P3.1 sont testés via HTTP avec les vrais guards métier, intercepteurs multipart et ValidationPipe, et une authentification/Prisma/S3 simulés.
- Pas de test frontend ou de modification frontend dans cette phase backend.

## Fichiers de cette phase

- Modifiés : `prisma/schema.prisma`, `src/app.module.ts`, `src/common/s3/s3.service.ts`, `src/modules/documents/documents.service.ts`.
- Ajoutés : `src/modules/sanctions/sanctions.module.ts`, `sanctions.controller.ts`, `sanctions.guard.ts`, `sanctions.dto.ts`, `sanctions.service.ts`, `sanctions-storage.service.ts`, `sanctions.fixtures.ts`, `sanctions.service.spec.ts`, `sanctions.controller.spec.ts`, `sanctions-storage.spec.ts`.
- Ajoutés : `prisma/migrations/20261028000000_add_sanctions/migration.sql` et ce rapport.
- Client généré : `generated/prisma`, ignoré par Git selon la convention existante.
- Les autres différences visibles dans Git (dont package.json/package-lock.json et migrations P1/P2) existaient avant P3.1 et n'ont pas été écrasées.

