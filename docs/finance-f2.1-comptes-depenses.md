# F2.1 — Comptes financiers et dépenses de dossier

## Résultat et périmètre

Implémentation réalisée et vérifiée statiquement. Aucun parcours authentifié ni mouvement financier exécuté. Aucun accès PostgreSQL/R2 pendant cette intervention, aucune migration, génération Prisma, installation npm, suite automatisée, commit ou push. Les développements locaux D1/D2/F1 sont préservés. F2.2 n'est pas commencé.

## Existant réutilisé

- Caisse, MouvementFinance, ActivityLog et les catégories Prisma existantes.
- FinanceService.createMouvement, calcul du solde à partir des mouvements, journalisation transactionnelle et transaction Serializable D3 avec réessais bornés.
- FinancePermissionService : canCreateMouvement et canViewCaisses pour l'enregistrement et la sélection.
- JwtStrategy global : utilisateur existant, actif et rôle courant vérifiés en base. La création revérifie aussi l'utilisateur en transaction.
- Accès global actuel des utilisateurs internes actifs aux dossiers, sans restriction d'affectation supplémentaire. Existence du dossier vérifiée en transaction. Aucun contrôle d'accès au compte par affectation individuelle n'existe dans le modèle actuel ; aucune politique nouvelle n'est introduite.
- Branche Dossier de MouvementDialog et composants Dialog/Select/Input/Textarea/Button, notification Sonner, filtres et liste existants.

## Comptes

TypeCaisse contient déjà ESPECES, BANCAIRE, MOBILE_MONEY et EPARGNE, ainsi que les valeurs historiques CARTE_BANCAIRE et AUTRE. Les services et formulaires généraux savent créer plusieurs comptes ; aucune unicité sur le nom ou le type n'impose un compte principal. Les fonctions générales de création, consultation, modification, désactivation et suppression ne sont pas modifiées.

Nouvel endpoint de sélection : GET /api/finance/comptes-depenses. Il réutilise les capacités existantes et retourne exclusivement [{id, nom}], triés par nom, pour les comptes actifs dont la devise est exactement XOF. Aucun solde, type, moyen, institution, titulaire ou identifiant bancaire n'est retourné par cet endpoint. Cache-Control: private, no-store. L'existant /finance/caisses reste inchangé pour ses autres consommateurs.

Le menu charge ces comptes à l'ouverture de la modale. Tous les types existants sont compatibles si actifs et XOF ; aucune limitation à ESPECES. Les comptes FCFA historiques sont exclus, sans normalisation ni conversion. Aucun compte n'est présélectionné. Le serveur revérifie compte, activité et devise lors de la création, même si la liste a changé depuis son chargement.

## Contrat de création

Route conservée : POST /api/finance/dossiers/:dossierId/depenses.

En-tête Idempotency-Key : UUID v4 requis.

Corps strict :

```json
{
  "categorie": "TRANSPORT",
  "motif": "Déplacement au tribunal pour une audience.",
  "montant": 5000,
  "date": "2026-11-16",
  "caisseId": "identifiant-du-compte-choisi"
}
```

Le dossier provient de la route ; l'auteur provient de l'authentification. Aucun auteur, solde, type, devise, destination ou moyen arbitraire n'est accepté dans ce DTO. Les validations contrôlent les six catégories, le motif non vide après trim, le compte, le montant positif à deux décimales maximum dans la capacité Decimal(15,2), et la date calendaire AAAA-MM-JJ. La date est conservée à minuit UTC selon le circuit D3 ; createdAt reste généré côté serveur.

La source reste AUTRE avec sourceLibelle « Dépense du dossier [référence] », comme D3 ; aucune valeur d'enum inventée.

## Moyen de paiement

MouvementFinance.moyenPaiement est facultatif dans Prisma et dans CreateMouvementDto. Il n'est donc pas nécessaire d'ajouter un sixième champ ou une migration.

Le serveur réutilise les moyens configurés du compte, ou les valeurs de compatibilité existantes lorsque sa liste est vide. Les anciennes valeurs CARTE et MOBILE_MONEY sont développées vers les moyens modernes existants. Une seule valeur distincte possible : elle est renseignée. Plusieurs possibilités ou aucune : champ null, sans deviner un virement, un chèque ou un opérateur.

Exemples : ESPECES sans configuration particulière donne ESPECES ; EPARGNE sans configuration donne VIREMENT selon le défaut déjà existant ; un compte bancaire VIREMENT/CHEQUE reste sans moyen précisé. Le tableau existant affiche alors « Non renseigné ». Il ne s'agit pas d'un encaissement de facture ou de provision, dont les exigences restent inchangées.

## Sécurité financière

- Un seul MouvementFinance SORTIE est créé par FinanceService, pour le compte sélectionné, le dossier, l'auteur et les cinq valeurs validées.
- Aucun solde courant n'est modifié manuellement. Le même mouvement alimente la liste Dossier, Finance et le calcul du compte ; aucune écriture miroir.
- Le contrôle du disponible utilise, pour les dépenses de dossier uniquement, des agrégats Prisma Decimal dans la transaction : initial + ENTREE + TRANSFERT entrants - SORTIE - TRANSFERT sortants. Aucune arithmétique flottante n'est utilisée pour cette comparaison ou pour construire le montant persisté. La formule existante n'est pas changée et aucun nouvel arrondi n'est ajouté.
- Solde insuffisant : HTTP 400, « Le solde du compte sélectionné est insuffisant pour enregistrer cette dépense. » Aucun solde divulgué dans ce message.
- Contrôle et écriture, avec journalisation, sont conservés dans la transaction Serializable D3. Deux dépenses par ce circuit doivent se sérialiser ; conflits P2034 réessayés de façon bornée.
- L'idempotence utilise l'identifiant unique du mouvement, dérivé de la clé. Rejeu identique : retourne l'identifiant sans nouvelle sortie ni nouvelle trace. Autre auteur, dossier, compte, montant, catégorie, motif normalisé ou date : HTTP 409.
- Le rejeu d'une opération déjà réussie ne crée pas de mouvement et peut retourner sa référence même si le compte a été désactivé depuis.
- La route manuelle existante conserve sa protection transactionnelle pour SORTIE liées à un dossier et n'impose plus de caisse physique. Elle valide désormais le compte choisi actif/XOF et conserve les contraintes D3 de catégorie/motif/date. Les créations hors dossier et transferts ne sont pas refondus.
- Factures, honoraires, paiements, provisions, imputations et reste à payer ne sont pas modifiés.

## Modale

Bouton « Ajouter une dépense », uniquement pour les capacités financières existantes. Ouverture directe dans l'onglet Finances, sans redirection vers Finance.

Titre « Ajouter une dépense » ; sous-titre « Enregistrer une dépense effectuée pour ce dossier. »

Exactement cinq champs visibles :

1. Nature : Transport, Restauration, Communication, Fournitures, Impression et photocopie, Autres.
2. Motif obligatoire, placeholder demandé, trim avant envoi.
3. Montant (FCFA), positif, deux décimales maximum.
4. Date de la dépense, jour courant UTC à l'ouverture, modifiable.
5. Compte à débiter, sélection unique sans valeur initiale ; seules les valeurs nom sont affichées.

Montant/date côte à côte à partir du breakpoint sm, verticalement sur petit écran. Dialog existant centré avec overlay et focus modal, défilement interne et bouton de fermeture. Retour du focus sur le bouton Dossier à la fermeture.

Chargement des comptes distinct de l'enregistrement ; message explicite si aucun compte compatible ; erreur de chargement avec bouton Réessayer, sans effacer la saisie. Soumission bloquée sans compte compatible chargé.

Pendant l'enregistrement : champs et boutons désactivés, verrou immédiat par ref contre les doubles clics, fermeture par croix/Escape/extérieur bloquée. Après erreur : modale ouverte et saisies conservées, correction possible. Après succès : notification, fermeture, réinitialisation et router.refresh sans rechargement complet ; invalidation des routes Dossier, Finance, comptes, mouvements et dashboard.

La clé est conservée pendant les tentatives. Après un résultat incertain, elle et la saisie restent conservées dans le composant même en cas de fermeture/réouverture. Aucun remplacement automatique de clé pour contourner un 409. Après succès, une nouvelle ouverture reçoit une nouvelle clé.

Le formulaire général Finance et ses catégories ne sont pas modifiés. Son bloc JSX a été comparé à la version disque avant F2.1 : identique. Les changements de chargement/soumission s'appliquent à expenseMode uniquement ; le comportement général conserve ses valeurs par défaut.

Les anciennes dépenses, catégories historiques, filtres, totaux par devise et justificatifs déjà présents dans la liste sont conservés. Aucun upload ajouté à la modale.

## Doublons métier et concurrence restante

Un avertissement dans la modale demande de vérifier que la dépense n'est pas déjà comptabilisée dans Finance. La liste Dossier existante permet de consulter les sorties déjà rattachées. Aucun rapprochement automatique ni blocage sur montant/date/catégorie, car deux dépenses distinctes peuvent les partager.

Cette protection informative et l'idempotence ne détectent pas toutes les doubles saisies, notamment si une dépense manuelle n'était pas liée au dossier. Une nouvelle clé volontaire, un autre navigateur ou un rechargement complet ne constituent pas le rejeu technique de la même clé. Les résultats incertains doivent être vérifiés avant une nouvelle saisie.

Les autres endpoints Finance peuvent toujours écrire simultanément sur le compte sans tous utiliser la même stratégie de concurrence. La garantie locale Serializable du circuit Dossier ne vaut pas garantie globale contre ces écrivains ; correction globale reportée à F2.2. Les modifications concurrentes d'un compte et les devises historiques restent aussi à traiter en F2.2.

## Transition D3 et documentation

L'unique dépendance de code à DOSSIER_EXPENSE_CAISSE_ID était le résolveur FinanceService.dossierExpenseCaisse. Elle est supprimée ainsi que sa restriction ESPECES. Aucun fallback vers une variable, un premier compte ou un compte principal. Le compte vient exclusivement du choix explicite de l'utilisateur.

Le document D3 est marqué historique et renvoie à ce rapport. Le rapport F1 reste le constat de sa phase. Aucune variable d'environnement n'est ajoutée, configurée ou supprimée. Les dépenses historiques conservent leurs associations et données.

## Fichiers de cette intervention

Backend :

- src/modules/finance/dto/create-dossier-expense.dto.ts
- src/modules/finance/finance.controller.ts
- src/modules/finance/finance.service.ts
- docs/dossier-d3-depenses-caisse.md (avertissement de remplacement des anciennes règles)
- docs/finance-f2.1-comptes-depenses.md

Frontend :

- src/app/(layout-pages)/finance/actions.ts
- src/components/finance/MouvementDialog.tsx
- src/app/(layout-pages)/dossiers/[id]/DossierExpenses.tsx

Le DTO et le document D3 étaient déjà non suivis dans Git ; les fichiers Finance/frontend contenaient déjà du travail local. Les différences Git complètes comprennent ces phases précédentes.

## Vérifications

- TypeScript backend production : `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit --incremental false` : réussi, exit 0.
- TypeScript frontend : `node node_modules/typescript/bin/tsc --noEmit --incremental false` : réussi, exit 0.
- git diff --check dans les deux dépôts : réussi, exit 0 ; avertissements LF/CRLF uniquement.
- Inspection statique des cinq champs, six catégories, sélection dynamique minimale sans solde ni présélection, protection des routes, rejeu avec compte différent, écriture unique, date, précision Decimal, source et journalisation transactionnelle.
- Recherche dans src : aucune dépendance restante à DOSSIER_EXPENSE_CAISSE_ID.
- Aucun changement Prisma ni migration nécessaire ; EPARGNE et le moyen nullable existent déjà.

Une première commande d'écriture frontend dépassait la limite Windows et n'a rien écrit. Les trois fichiers ont ensuite été appliqués après autorisation depuis un manifeste local temporaire, avec vérification de toutes les empreintes avant écriture. Les contrôles finaux ci-dessus portent sur les fichiers effectivement enregistrés.

## Recette manuelle préparée — non exécutée

À exécuter sur une base de test isolée, jamais sur les données financières réelles du cabinet pour les créations ci-dessous.

1. AVOCAT puis COMPTABLE actifs : ouverture depuis le dossier, cinq champs, six catégories, compte non présélectionné, noms seuls, navigation clavier/focus, mobile et défilement. Annuler/fermer puis ouvrir une nouvelle dépense.
2. Utilisateur non habilité : bouton absent et refus des deux routes. Sans authentification ou utilisateur inactif : refus JWT. Le DTO ne doit pas accepter auteur/solde/destination arbitraires.
3. Comptes actifs XOF des quatre types : proposés. Comptes inactifs, FCFA ou autre devise : exclus et refusés même en falsifiant le corps. Compte inexistant : 404. Préserver les comptes historiques.
4. Échec de chargement : erreur et Réessayer, aucune saisie effacée. Liste vide : message et soumission désactivée. Changement d'activité du compte entre sélection et POST : refus serveur.
5. Validation : motif espaces, catégorie hors liste, zéro/négatif, plus de deux décimales, dépassement de capacité et date impossible : refus sans écriture.
6. Compte de test suffisamment approvisionné : une sortie, bon dossier/auteur/compte, même opération visible dans Finance et dépenses, baisse exacte du solde de ce seul compte. Honoraires, provisions et reste client inchangés.
7. Solde insuffisant : message exact sans montant de solde, formulaire ouvert et saisie conservée, sélection d'un autre compte possible. Aucun découvert ni mouvement artificiel.
8. Moyen : compte espèces => ESPECES ; configuration unique => moyen correspondant ; banque à plusieurs moyens => null, aucun virement inventé. Aucun sixième champ.
9. Double clic et même clé simultanée : un seul mouvement. Rejouer exactement : même identifiant. Changer séparément montant/compte/dossier/catégorie/motif/date : 409. Erreur réseau après commit : réessayer la même clé, sans nouvelle sortie.
10. Deux dépenses concurrentes du même compte avec un solde insuffisant pour les deux : pas de consommation simultanée du même disponible par ce circuit. Vérifier le rollback de la journalisation et du mouvement en cas d'erreur sur environnement isolé.
11. Fermeture bloquée pendant enregistrement ; erreur conserve la saisie ; succès notifie, ferme, réinitialise, actualise listes et données sans rechargement complet.
12. Dépense déjà saisie manuellement dans Finance : contrôler l'avertissement et la consultation des écritures. Deux dépenses légitimes de même montant/date restent possibles. Vérifier historiques et formulaire Finance général inchangés.

Aucun de ces parcours réels n'est déclaré exécuté. Restent principalement la recette authentifiée, les cas concurrents globaux F2.2 et le traitement FCFA/XOF F2.2.
