# D1 — stabilisation du module Dossier

Intervention du 14 novembre 2026. Périmètre : PATCH Dossier, KYC existant, statuts/archivage, références et événements Velarium. Aucune modification du schéma, migration, règle de permission, calcul financier, formulaire de dépenses ou module Sanctions. Aucun commit/push ni lancement Jest/suite automatisée.

## Fichiers modifiés

Backend, relatifs à velarium_api :

- `src/modules/dossiers/dossiers.service.ts` : validation, PATCH, état KYC final, transitions, numérotation et transactions.
- `src/modules/evenements/evenements.service.ts` : PATCH, validation de l’état final et dates.
- `src/modules/evenements/dto/create-evenement.dto.ts` : types des propriétés, dates ISO strictes et champs facultatifs nullable.
- `src/modules/evenements/dto/update-evenement.dto.ts` : PATCH partiel rejetant null sur les champs obligatoires.
- `src/modules/dossiers/dossiers.service.spec.ts` : mocks adaptés à la lecture de l’état dans la transaction ; assertions adaptées, sans exécution.
- `src/modules/dossiers/dossiers-opening-payment.spec.ts` : mocks de comptage et vérification des références déplacés dans les délégués transactionnels, sans exécution.
- `docs/dossier-d1-stabilisation.md` : présent rapport.

Frontend, relatifs à velarium_front :

- `src/app/(layout-pages)/dossiers/actions.ts` : champs facultatifs nullable et conservation de la distinction absent/null/valeur.
- `src/app/(layout-pages)/dossiers/DossierForm.tsx` : seuls les champs modifiés sont transmis ; collaborateurs inchangés non remplacés.
- `src/app/(layout-pages)/agenda/actions.ts` : contrats distincts création/PATCH, dates avec fuseau, normalisation des effacements.
- `src/app/(layout-pages)/dossiers/AddEcheanceDialog.tsx` : conversion de l’heure locale du navigateur en ISO avec fuseau.
- `src/components/calendar/event-dialog.tsx` : dates Velarium, effacements volontaires, champs non modifiés omis et erreurs compréhensibles.

UpdateDossierDto et DossierStatusSelect ont été examinés sans modification : le DTO distingue déjà les champs requis des champs nullable ; le sélecteur transmet uniquement le statut. Les autres modules restent inchangés.

## Avant / après

Avant : les nom/e-mail adverses absents devenaient null ; les autres champs vidés dans le formulaire étaient transformés en undefined ; le KYC était validé surtout à partir du DTO ; un statut CLOTURE renvoyé réinitialisait sa date ; les PATCH d’événements effaçaient leurs champs facultatifs.

Après :

- Champ absent : conservé. Champ facultatif explicitement null : effacé lorsque les règles le permettent. Nouvelle valeur : remplace la valeur précédente. Champ obligatoire null, vide ou invalide : rejeté.
- Les cinq champs juridiques facultatifs concernés peuvent être volontairement vidés depuis le formulaire. Les clés historiques avocatClient* sont conservées.
- Les collaborateurs sont conservés lorsque la liste est absente ; [] les retire ; une liste fournie est validée, dédupliquée et remplacée dans la transaction. Le formulaire évite le remplacement d’un ensemble inchangé.
- Quand un champ KYC est fourni, la validation fusionne les valeurs reçues avec celles enregistrées dans la transaction. Activer le soupçon peut réutiliser une déclaration existante non vide. Effacer la déclaration avec soupçon final actif est refusé. Désactiver le soupçon ne supprime pas automatiquement sa déclaration.
- Une modification hors KYC reste possible sur un ancien dossier KYC incomplet, conformément au comportement de compatibilité déjà exprimé dans les tests existants. Aucune réparation historique automatique.
- Statut absent ou identique : dateCloture conservée, même si historiquement absente. Transition vers CLOTURE : date courante. Création directement CLOTURE : date courante renseignée.
- Réouverture : dateCloture effacée, comme dans la règle préexistante. Aucune nouvelle règle métier de réouverture n’est introduite.
- Un dossier archivé doit être désarchivé avant de passer à un statut différent de CLOTURE. L’archivage vérifie le statut final dans sa transaction. Une répétition d’archivage/désarchivage ne change pas la date et ne crée pas un nouveau journal lorsqu’aucun changement n’a lieu.

## Références et concurrence

Les formats YYYY-NNN et REC-YYYY-NNNN restent identiques, avec leur largeur minimale actuelle. Les valeurs historiques ne sont jamais renumérotées.

La génération conserve le point de départ comptage annuel + 1, désormais calculé dans la transaction. Une vérification de disponibilité fait avancer un candidat déjà occupé, notamment après des trous dans l’historique.

Les transactions Dossier utilisent le niveau Serializable. Jusqu’à trois tentatives complètes sont prévues pour un conflit de sérialisation P2034 ; la création reprend aussi les collisions P2002 relatives aux références Dossier ou numéros de reçus. Une transaction échouée est abandonnée entièrement avant la suivante. Les autres erreurs ne sont pas masquées. Après épuisement, un HTTP 409 demande une nouvelle tentative.

La transaction de création contient toujours le dossier, le mouvement, les frais d’ouverture et le reçu. Le contrôle de paiement obligatoire, les permissions de caisse, la devise, les montants et moyens de paiement existants sont conservés. Le journal d’activité reste après la transaction, comme auparavant.

Les autres générateurs de reçus, notamment celui des provisions, n’ont pas été modifiés. Leur harmonisation globale relève de l’audit Finance ; la protection D1 porte sur le parcours Dossier. La concurrence réelle et les scénarios de reprise restent à vérifier sur une base de validation.

## Événements et dates

Les champs absents d’un PATCH sont conservés. Les propriétés facultatives peuvent être effacées par null. Le titre, le début et le type ne peuvent pas être effacés. Début/fin sont fusionnés avec la ligne existante puis validés dans une transaction Serializable, avec reprises bornées des conflits P2034.

Une fin antérieure au début est refusée à la création comme lors d’un PATCH, même si une seule borne a été transmise. Une fin égale au début reste autorisée, conformément à la règle demandée. Un événement historique incohérent n’est pas corrigé automatiquement : son prochain enregistrement doit rétablir une chronologie valide.

Les dialogues Velarium convertissent les heures du navigateur en ISO avec fuseau avant transmission. Lorsqu’un horaire n’a pas été modifié, sa valeur absolue et sa précision d’origine sont conservées. Les dates sans fuseau des anciens appelants API sont interprétées en UTC de manière déterministe ; aucun horaire enregistré n’est reconverti. La fiche conserve son affichage UTC et les dialogues précisent le fuseau de saisie.

Les champs facultatifs inchangés du dialogue ne sont plus réémis lors d’une modification Velarium. Les valeurs vidées sont transmises explicitement. Le parcours de conversion et les contrats Google Calendar restent distincts : aucun service, hook ou endpoint Google n’a été modifié. Une recette Google reste nécessaire ; ce constat statique ne garantit pas son fonctionnement en conditions réelles.

## Rôles responsables : constat réel, politique inchangée

Comptages anonymes effectués en transaction PostgreSQL READ ONLY, puis ROLLBACK. Aucun nom ni identifiant de personne affiché.

| Rôle technique | Dossiers | Responsables distincts | Actifs |
| --- | ---: | ---: | --- |
| COLLABORATEUR_ASSOCIE | 11 | 2 | Oui |
| SECRETARIAT | 8 | 2 | Oui |
| COMPTABLE | 6 | 1 | Oui |

La base comporte également un utilisateur AVOCAT actif et cinq COLLABORATEUR_ASSOCIE actifs au total ; aucun utilisateur inactif n’a été trouvé. Aucun responsable n’a été requalifié.

La sélection existante /users retourne les utilisateurs sans filtre d’activité et sans propriété active. Si un compte devient inactif, il peut encore être proposé par cette sélection ; le service Dossier rejette néanmoins un responsable nouvellement choisi inactif. Les collaborateurs sont contrôlés sur leur existence, sans nouvelle restriction d’activité ou de rôle. La liste des rôles éligibles et le comportement de sélection restent à valider par le cabinet avant modification de cette politique.

## Vérifications

- TypeScript backend production : `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit --incremental false` — réussi.
- TypeScript frontend : `node node_modules/typescript/bin/tsc --noEmit --incremental false` — réussi, y compris après les derniers ajustements frontend.
- `git diff --check` des deux dépôts — réussi. Les avertissements Git LF/CRLF ne sont pas des erreurs d’espaces.
- Aucun Jest ni autre suite automatisée exécutée. Les deux fichiers de tests modifiés contiennent uniquement l’adaptation des mocks/attentes au nouveau périmètre transactionnel ; ils ne sont pas déclarés validés par exécution.
- Aucun démarrage de serveur, appel de mutation, écriture PostgreSQL/R2, migration, génération Prisma, installation npm, commit ou push.
- Les vérifications statiques ne constituent pas une recette authentifiée ni un test PostgreSQL de concurrence.

| Scénario D1 | Revue statique |
| --- | --- |
| Statut seul sans perte de coordonnées | Champs absents transmis à Prisma comme undefined |
| Un seul champ modifié | Formulaire ciblé et PATCH conservant les absents |
| Effacement volontaire facultatif | null conservé par l’action puis persisté |
| Effacement obligatoire | Validation DTO/service, avant toute écriture |
| KYC final | Fusion des champs reçus et persistés dans la transaction |
| Date de clôture conservée | Comparaison avec le statut enregistré |
| Dossier archivé protégé | Transition incompatible refusée, archivage transactionnel |
| Chronologie événement | Fusion puis comparaison avant enregistrement |
| Création atomique | Toutes les écritures restent dans le même callback transactionnel |

## Procédure manuelle pour l’événement historique incohérent

1. Dans un dossier, ouvrir Procédure et événements, puis le groupe Dates à vérifier ; aucune modification n’a été faite par D1 sur cet événement.
2. Un utilisateur autorisé consulte la source de l’audience/rendez-vous et détermine les heures réelles. Ne pas choisir arbitrairement une nouvelle heure pour faire disparaître l’alerte.
3. Ouvrir Modifier l’événement, corriger le début et/ou la fin en tenant compte du fuseau du navigateur. Si la fin est réellement inconnue, sa suppression volontaire doit être validée par la personne responsable.
4. Enregistrer puis contrôler la chronologie dans le dossier (UTC) et dans l’Agenda (affichage local). Vérifier que le rattachement et les autres champs sont conservés.

## Recette et décisions restantes

Sur un environnement de validation et avec des données de test autorisées : effectuer les neuf scénarios D1, l’activation/désactivation KYC avec et sans déclaration préexistante, les PATCH null/absents/valeurs, la réouverture après désarchivage, la création directement clôturée et les créations concurrentes. Vérifier les effets dans les événements Velarium et le maintien des créations/modifications Google Calendar.

Décision métier attendue : rôles responsables éligibles et politique d’activité des collaborateurs/sélections. Aucun changement de politique n’a été appliqué.

Risques résiduels : reprises limitées à trois tentatives sous forte concurrence ; autres émetteurs de reçus non harmonisés ; absence de recette réelle ; journalisation post-transaction inchangée pouvant échouer après une mutation déjà validée. Les contrôles de confidentialité repérés par l’audit final ne sont pas traités par D1, conformément à son périmètre.
