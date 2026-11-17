# F1 — Sécurité et indicateurs du dashboard général

## Périmètre et résultat

F1 uniquement. Les modifications locales D1/D2/D3 ont été conservées. Aucune modification des services Factures, Provisions, Finance, KYC, Documents ou Calendar pendant F1. Aucun changement Prisma, PostgreSQL ou R2, aucune migration, installation npm, suite automatisée, opération financière, commit ou push. DOSSIER_EXPENSE_CAISSE_ID n'a pas été configuré ; D3 reste non activé.

## Cause et protection

GET /api/dashboard/summary était authentifié par le garde JWT global, mais sans contrôle des capacités Finance. Le RolesGuard global accepte les routes sans annotation. Le service interrogeait et retournait systématiquement les données financières, et journalisait les séries dans la console.

Le contrôleur transmet désormais le rôle courant fourni par JwtStrategy, qui vérifie déjà l'existence, l'activité et le rôle de l'utilisateur en base. Le module importe FinanceModule pour réutiliser FinancePermissionService sans modifier sa politique.

Le service charge d'abord les seuls compteurs opérationnels. Sans canViewFinance, il retourne immédiatement, avant toute requête financière. Les groupes suivants sont conditionnés séparément :

| Capacité | Données accessibles |
| --- | --- |
| Utilisateur authentifié actif | Dossiers en cours, échéances à sept jours, compteurs clients, période, capacités |
| canViewFinance | Impayés des factures éligibles |
| canViewFinance + canViewCaisses | Solde global courant |
| canViewFinance + canViewMouvements | Encaissements/décaissements, séries, derniers paiements de la période |

Selon la politique existante, AVOCAT et COMPTABLE possèdent actuellement les trois capacités. Les autres rôles ne reçoivent aucune clé monétaire, série ou projection de paiement. L'inactivité reste refusée par JwtStrategy. Les comptes détaillés ne sont pas exposés par cette route.

Cache-Control est private, no-store. Le client API existant utilise également no-store. La trace console des séries a été supprimée. Aucune modification des gardes globaux ou de la politique de permissions.

## Formules et périodes

- Dates explicites : format AAAA-MM-JJ, dates calendaires vérifiées ; début à 00:00:00.000Z, fin à 23:59:59.999Z, bornes inclusives. Inversion ou date invalide : HTTP 400.
- Défaut conservé : premier jour du mois courant à minuit UTC jusqu'à l'instant présent.
- Entrées : mouvements ENTREE de la période + paiements et provisions historiques sans mouvement de cette même période. Traitement historique conservé pour F3.
- Sorties : mouvements SORTIE de cette même période, au lieu de la fenêtre glissante de six mois précédemment utilisée par erreur.
- Graphiques : mêmes lignes que les cartes, regroupées par mois UTC sur la période sélectionnée. Clés année/mois et libellés avec année, donc pas de fusion de janvier de deux années différentes. Les mois chargés avec aucune opération valent réellement zéro.
- Derniers paiements : sept derniers paiements de facture dans la période sélectionnée.
- Transferts : toujours exclus des entrées/sorties, mais conservés dans le solde courant.
- Solde : initial + entrées + transferts entrants - sorties - transferts sortants, toutes dates confondues. Aucun nouveau calcul de solde filtré.
- Impayés : somme des restes positifs des factures ENVOYEE, PARTIELLEMENT_PAYEE, EN_RETARD, avec paiements, imputations explicites et affectations historiques. Toutes dates confondues, formule et statuts conservés.

Les cartes de solde et d'impayés sont explicitement libellées « toutes dates confondues ». Aucune variation de trésorerie n'est ajoutée.

## Contrats et interface

Les champs financiers et séries sont facultatifs selon les capacités ; un montant disponible est number, un montant indisponible null. La conversion backend ne transforme plus null/undefined en zéro. Les sommes propagent l'indisponibilité et seules les collections réellement chargées et vides donnent zéro.

Le frontend n'appelle que le summary général authentifié. Il utilise ses capacités pour monter les seuls composants autorisés, sans appel supplémentaire à Finance. Si les capacités manquent sur une réponse ancienne, les composants financiers restent cachés.

- Non autorisé : composant financier absent, aucun faux zéro.
- Autorisé mais valeur absente/null/non finie : « Indisponible ».
- Série ou point absent : pas de zéro de secours ; points null non tracés, total incomplet indisponible.
- Chargement : transition du filtre et skeletons Suspense existants.
- Échec de récupération : alerte du dashboard, sans montant inventé ni instruction trompeuse de démarrage API.
- Paiements chargés vides : message distinct de paiements indisponibles.

Les composants et styles existants sont réutilisés ; aucune nouvelle page ni nouvel endpoint.

## Devises et limites conservées

Aucune normalisation FCFA/XOF ni conversion. L'agrégation historique existante reste inchangée ; un avertissement explicite apparaît lorsque les comptes ou mouvements consultés portent une devise différente de XOF. Ce total ne doit pas être interprété comme un total comptable réconcilié. F2 doit clarifier ce périmètre et les devises des comptes.

Un avertissement séparé signale les encaissements historiques sans mouvement inclus dans la période. Leur devise, leur rapprochement et la coexistence éventuelle d'affectations historiques/explicites restent du ressort de F3. Les formules de facture et provision ne sont pas modifiées. Les arrondis d'affichage existants à l'unité restent conservés ; la précision et les calculs flottants seront traités dans le périmètre ultérieur validé.

## Fichiers F1

Backend :

- src/modules/dashboard/dashboard.controller.ts
- src/modules/dashboard/dashboard.module.ts
- src/modules/dashboard/dashboard.service.ts
- docs/finance-f1-securite-indicateurs.md

Frontend, sous src/app/(layout-pages)/dashboard/ :

- actions.ts
- AnalyticsDashboard.tsx
- ClientStatsCards.tsx
- revenue-chart-card.tsx
- transactions-card.tsx
- PeriodFilter.tsx
- page.tsx

## Vérifications réalisées

- TypeScript backend production : `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit --incremental false` : exit 0.
- TypeScript frontend : `node node_modules/typescript/bin/tsc --noEmit --incremental false` : exit 0.
- git diff --check backend et frontend : exit 0 ; avertissements de conversion LF/CRLF uniquement.
- Inspection des appels, projections conditionnelles, garde JWT actif, exclusion des transferts, bornes UTC, états null, consommateurs du contrat et absence de modification hors périmètre F1.

Pas de Jest ni autre suite automatisée. Aucun parcours authentifié ni requête HTTP réelle exécuté pour valider F1. Aucune connexion PostgreSQL/R2 effectuée pendant F1. Les résultats ci-dessus sont statiques.

## Recette manuelle préparée, non exécutée

Utiliser les comptes de recette existants et des requêtes GET ; aucune opération financière réelle nécessaire.

1. Sans session, vérifier le refus du summary. Avec un compte inactif, vérifier le refus JWT.
2. Avec chaque rôle actif non habilité (selon les comptes disponibles), vérifier HTTP 200, compteurs opérationnels présents, absence des clés totalEntrees/totalSorties/soldeGlobal/impayes/entreesParMois/sortiesParMois/derniersPaiements dans le JSON et dans la charge utile de la page Next. Vérifier absence d'appels Finance et de composants financiers dans le navigateur.
3. Avec AVOCAT puis COMPTABLE actifs, vérifier les capacités, cartes, graphiques et paiements autorisés ; aucun secret ni compte détaillé dans le summary. Vérifier Cache-Control.
4. Sélectionner une journée comportant des opérations existantes, puis une période sans opération ; vérifier minuit UTC et fin de journée inclusive, absence des opérations voisines et vrais zéros uniquement pour la période chargée vide.
5. Sélectionner deux périodes distinctes, une période traversant décembre/janvier et une période couvrant deux années : comparer les sommes des séries aux cartes correspondantes et vérifier les libellés annuels.
6. Vérifier défaut mois courant/jusqu'à maintenant, changement et remise à zéro du filtre, état de chargement, erreur réseau, date impossible et période inversée (400).
7. Vérifier qu'un transfert existant ne change ni encaissements ni décaissements et que le solde courant reste identique lorsqu'on change la période.
8. Sur un environnement local de recette utilisant une réponse API simulée sans persistance, vérifier null/champ absent/point absent : « Indisponible » ou absence de tracé, jamais zéro fabriqué. Une liste de paiements vide doit rester distincte d'une liste absente.
9. Vérifier les avertissements FCFA/XOF et historiques, sans correction de données. Vérifier que les parcours Dossier/Documents/D3 restent ceux des phases précédentes, sans activer D3.
