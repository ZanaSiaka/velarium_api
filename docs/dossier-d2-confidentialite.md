# D2 — confidentialité du module Dossier

Intervention du 14 novembre 2026. Les travaux D1 déjà présents ont été conservés. Ce rapport distingue les corrections D2 des validations opérationnelles restant à effectuer.

## Politiques validées pendant l’intervention

- Lecture et modification KYC réservées au rôle technique AVOCAT actif. Aucun rapprochement automatique avec les rôles responsables des dossiers.
- Documents génériques : lecture et dépôt pour les utilisateurs internes actifs ayant l’accès global actuel aux dossiers ; suppression par l’auteur du dépôt ou un AVOCAT actif. Aucune restriction d’affectation ajoutée.
- INTERNE et VISIBLE_CLIENT restent privés. VISIBLE_CLIENT n’est pas un accès public et ne crée aucun portail client.
- Le COMPTABLE conserve la création d’un dossier avec encaissement sans saisie KYC : soupçon faux par défaut pour un nouveau dossier, sans déclaration. Une valeur false de création reste compatible ; une activation ou une déclaration exige AVOCAT. Les modifications KYC d’un dossier existant sont refusées aux autres rôles.

## KYC et projections

Deux sélections Prisma partagées ont été introduites : DOSSIER_PUBLIC_SELECT pour les données générales, DOSSIER_REFERENCE_SELECT pour les relations secondaires. Elles ne contiennent aucun champ KYC, relation financière ou utilisateur complet.

- GET /api/dossiers et /archives : liste générale sans KYC ; frais d’ouverture uniquement avec canViewFinance. Aucun compte financier dans cette projection.
- GET /api/dossiers/:id : données générales, client et équipe ; KYC ajouté uniquement après vérification du rôle/activité de l’utilisateur en base.
- POST/PATCH et archivage/désarchivage : réponse reconstruite avec la même projection autorisée, sans retour brut du dossier contenant le KYC.
- POST/PATCH KYC : contrôle AVOCAT actif dans la transaction, avant modification. La validation de l’état final du D1 est conservée ; les modifications hors KYC ne suppriment pas les déclarations historiques.
- Documents, Événements, Client, Factures, Paiements et Reçus : projections Dossier limitées explicitement. Les inclusions complètes dossier:true ont été retirées sur les chemins inspectés. Les relations Clients n’exposent plus non plus l’utilisateur responsable complet.
- Cache-Control private, no-store ajouté aux réponses Dossier et documentaires sensibles.

Le frontend détermine le droit KYC côté serveur via /auth/me. La section et les champs de mutation KYC ne sont pas transmis par les formulaires non habilités. Le backend reste l’autorité ; le masquage seul n’est pas une protection.

Le journal générique existant filtre déjà les historiques spécialisés et ne restitue pas les métadonnées brutes. Aucun log de déclaration KYC n’a été ajouté. Le dépôt documentaire ne journalise plus le nom du document dans les métadonnées de son événement. Les logs client contenant la réponse brute R2 ont été retirés. PrismaService n’active pas de journalisation des requêtes SQL.

## Données financières du dossier

Les relations factures, provisions, reçus, mouvements et comptes ne sont plus retournées par la réponse principale du dossier, même pour les utilisateurs habilités. La fiche utilise déjà les endpoints dédiés et le livre des paiements.

FinancePermissionService est réutilisé sans modification de sa matrice. Un guard de données financières contrôle canViewFinance et canViewCaisses, avec revérification du compte actif, sur les contrôleurs Factures, Provisions, Paiements et Reçus ainsi que sur le livre du Client. Ces contrôleurs peuvent retourner des données financières/de caisse dans leurs lectures ou réponses de mutation ; ils ne constituent plus un contournement de la réponse Dossier filtrée.

GET /api/dossiers/frais-ouverture reçoit également un contrôle financier. Le contrôle préexistant du livre du dossier est conservé.

Aucun calcul, montant, paiement, imputation ou état comptable n’a été modifié. Les changements des services Factures/Paiements/Reçus concernent uniquement les projections relationnelles. Le tableau de bord global et la totalité du module Finance ne font pas l’objet d’un audit de confidentialité exhaustif dans ce lot Dossier ; cet audit reste distinct.

## Documents et stockage

Chaque opération documentaire reçoit l’identité de l’utilisateur et vérifie le compte actif. Le dossier référencé doit exister. Le périmètre reste global entre utilisateurs internes, conformément à la validation métier ; l’appartenance au dossier n’est pas une condition d’accès ajoutée.

- Liste et dossiers documentaires : métadonnées autorisées uniquement ; ni storageKey ni URL historique retournés.
- Dépôt : clé UUID générée côté serveur sous dossiers/{dossierId}/ ; le nom fourni n’est plus utilisé pour construire la clé.
- Confirmation : jeton HMAC de cinq minutes lié à l’utilisateur, au dossier, à la clé, au nom, au MIME et à la taille. Il utilise le secret existant avec un domaine de signature documentaire distinct, sans modifier l’authentification.
- Les métadonnées réelles de l’objet sont lues par HEAD avant enregistrement ; taille et MIME doivent correspondre à la confirmation signée.
- La confirmation vérifie les doublons dans une transaction Serializable : un rejeu ou une confirmation concurrente ne doit pas créer une seconde ligne. Un conflit impose de recharger la liste, sans création automatique supplémentaire.
- Le PUT signé est conditionnel, avec If-None-Match: *, pour empêcher la réutilisation de l’URL afin d’écraser un objet déjà déposé. Taille et en-têtes attendus font partie du contrat signé.
- Consultation, téléchargement et suppression chargent le document en base, contrôlent son dossier et sa clé, puis effectuent le contrôle d’autorisation avant l’opération de stockage.
- La suppression requiert l’auteur ou AVOCAT actif et ne peut pas utiliser une clé fournie librement par le client.
- Les nouvelles URL signées restent valables 300 secondes. Leur émission est authentifiée ; elles ne rendent pas le bucket public. Comme toute URL présignée, elles restent des liens porteurs utilisables jusqu’à expiration.
- Les contenus actifs, notamment HTML et SVG, ne sont pas rendus inline. La prévisualisation inline est limitée aux MIME PDF, JPEG, PNG, GIF et WebP ; les autres sont servis en téléchargement avec application/octet-stream.
- Les clés sanctions-private restent exclues des Documents génériques et protégées par leur module dédié, inchangé.

Les documents historiques ne sont pas déplacés, renommés ou corrigés. Les métadonnées génériques restent listées ; une ancienne clé hors du dossier est signalée comme non consultable/non supprimable par ce canal et nécessite une revue manuelle. Aucune clé hors périmètre n’est signée automatiquement.

Les noms vides, caractères de contrôle et séparateurs de chemin sont rejetés. La taille doit être un entier positif représentable et correspondre à l’objet. La syntaxe MIME est contrôlée. Les extensions restent dans le nom d’origine ; elles ne constituent pas une preuve du contenu du fichier.

Aucune liste blanche métier de formats ni limite fixe de taille n’existait pour les Documents génériques. Aucune n’a été inventée à partir des limites Finance ou Sanctions. DOCUMENT_MAX_FILE_BYTES permet d’imposer un plafond serveur lorsqu’il est explicitement configuré ; sans configuration, aucun plafond métier n’est imposé. Le plafond et les formats autorisés restent à définir par le cabinet. Les contrôles de métadonnées ne sont ni une analyse antivirus ni une identification binaire complète des formats.

La fonction frontend getPreviewUrl appelait /preview, inexistant : elle utilise désormais /view. Le backend existant est réutilisé. Aucun nouveau portail ou visualiseur n’a été créé.

## Fichiers D2

Backend, relatifs à velarium_api :

- `src/common/dossier-projections.ts` — nouvelles projections partagées.
- `src/common/guards/financial-data.guard.ts` — contrôle des données financières selon les capacités existantes.
- `src/common/s3/s3.service.ts` — opérations documentaires signées et HEAD, méthodes existantes conservées.
- `src/modules/dossiers/dossiers.service.ts`, `dossiers.controller.ts`, `dto/create-dossier.dto.ts`.
- `src/modules/documents/documents.service.ts`, `documents.controller.ts`, `dto/presign-upload.dto.ts`, `dto/create-document.dto.ts`.
- `src/modules/evenements/evenements.service.ts` — projections seulement dans D2 ; corrections D1 conservées.
- `src/modules/clients/clients.service.ts`, `clients.controller.ts`, `clients.module.ts`.
- `src/modules/factures/factures.service.ts`, `factures.controller.ts`, `factures.module.ts`.
- `src/modules/paiements/paiements.service.ts`, `paiements.controller.ts`, `paiements.module.ts`.
- `src/modules/provisions/provisions.controller.ts`, `provisions.module.ts`.
- `src/modules/recus/recus.service.ts`, `recus.controller.ts`, `recus.module.ts`.
- `src/modules/dossiers/dossiers.service.spec.ts`, `dossiers-opening-payment.spec.ts` — adaptation des mocks/attentes de contrat, sans exécution.
- `docs/dossier-d2-confidentialite.md` — présent rapport.

Frontend, relatifs à velarium_front :

- `src/lib/dossier-kyc-access.ts`.
- `src/app/(layout-pages)/dossiers/actions.ts`, `DossierForm.tsx`, `nouveau/page.tsx`, `[id]/modifier/page.tsx`.
- `src/app/(layout-pages)/documents/actions.ts`.
- `src/components/documents/DocumentUpload.tsx`, `DocumentsList.tsx`.

Les autres modifications visibles dans Git provenant de D1 n’ont pas été écrasées et ne sont pas attribuées à D2. Aucun changement Prisma, FinancePermissionService, formulaire de dépenses P2.1, Auth ou Sanctions.

## Vérifications et limites

- TypeScript backend production : `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit --incremental false` — réussi.
- TypeScript frontend : `node node_modules/typescript/bin/tsc --noEmit --incremental false` — réussi.
- git diff --check des deux dépôts — réussi, avec avertissements de normalisation LF/CRLF sans erreur d’espaces.
- Aucun Jest ni autre suite automatisée lancé. Les fichiers de tests adaptés ne sont pas déclarés réussis par exécution.
- Aucun appel de mutation, upload, HEAD ou autre requête R2 n’a été exécuté pour la recette. Aucun démarrage d’application, accès PostgreSQL, installation npm, migration, commit ou push dans D2.
- Contrôle statique des projections KYC secondaires, des réponses financières filtrées et des guards. Les endpoints financiers restent disponibles par code pour AVOCAT/COMPTABLE selon la matrice existante ; aucun compte réel n’a été utilisé pour l’exécuter.
- La réduction des réponses ne modifie pas les transitions D1, le calcul KYC final, les références transactionnelles ni les événements Google. Les six rubriques de la fiche restent présentes ; l’historique et le module Sanctions restent séparés.

L’autorisation d’un dernier ajustement de types frontend rendant les frais de liste facultatifs a été refusée. Il n’a pas été appliqué, relancé ni contourné. Les types historiques de liste restent donc plus stricts que le payload filtré ; le rendu existant traite déjà une absence de frais, et le contrôle TypeScript final réussit. Cette limite de contrat reste explicitement à reprendre si autorisée.

## Actions manuelles avant mise en service

1. Déployer ensemble backend et frontend : la confirmation documentaire requiert désormais uploadToken et les en-têtes de PUT renvoyés par le presign.
2. Vérifier le CORS du bucket pour le PUT et les en-têtes Content-Type/If-None-Match. Aucun changement de configuration R2 n’a été effectué. Un bucket qui n’autorise pas If-None-Match bloquera le nouvel upload conditionnel jusqu’à adaptation autorisée.
3. Vérifier que le bucket et tout domaine associé ne donnent pas un accès public aux objets. Le code ne peut pas retirer une exposition publique configurée hors application.
4. Définir le plafond documentaire et les formats métier autorisés ; configurer DOCUMENT_MAX_FILE_BYTES si un plafond est validé.
5. Sur un environnement de validation, vérifier AVOCAT actif, COMPTABLE et autre rôle interne, puis compte inactif : listes, détail, création, PATCH KYC et réponses des mutations.
6. Vérifier le maintien de l’accès financier AVOCAT/COMPTABLE et les refus des autres rôles sur les endpoints liés ; confirmer le fonctionnement de l’onglet Finances sans les anciennes relations du détail.
7. Tester upload/confirmation : clé d’un autre dossier, jeton altéré/expiré/autre utilisateur, taille/MIME incohérents, fichier absent, rejeu, confirmations concurrentes et tentative de remplacement de l’objet.
8. Tester lecture, /view, téléchargement et suppression auteur/AVOCAT/autre utilisateur, sans appeler les pièces Sanctions par le module générique. Utiliser des objets de test autorisés.
9. Examiner manuellement les éventuelles clés historiques hors dossier, sans déplacement automatique. Un upload réussi mais non confirmé peut laisser un objet orphelin ; aucune suppression automatique n’est introduite.

Risques résiduels : plafond/formats non définis, analyse de contenu non complète, configuration CORS/publicité du bucket non vérifiée réellement, durée porteuse des URL signées, absence de recette et de test de concurrence. La suppression R2 et la suppression de la ligne PostgreSQL ne constituent pas une transaction distribuée ; leur comportement historique nécessite une vérification opérationnelle. Les autres endpoints globaux du module Finance/Dashboard relèvent de l’audit Finance séparé.
