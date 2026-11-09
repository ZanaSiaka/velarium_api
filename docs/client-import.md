# Import Excel des clients — P2

## Audit et choix

- Les routes Clients existantes ne restreignent pas les rôles. Le nouvel import est limité au rôle AVOCAT, sur les deux routes, selon la décision métier explicite. Les autres routes et permissions restent inchangées.
- Le DTO CreateClientDto et la règle P1 (numéro contribuable optionnel, réservé aux entreprises) sont réutilisés. La migration P1 est une précondition de déploiement.
- Le frontend avait uniquement un export XLSX, avec une ancienne bibliothèque xlsx. Le nouvel import ne dépend pas de ce lecteur : yauzl décompresse sous limites et sax lit les XML en mode strict, sans moteur de calcul ou accès à des ressources externes.

## Format accepté

Une seule feuille .xlsx ; ligne 1 avec `type` et `nom` obligatoires. Colonnes optionnelles : `email`, `telephone`, `adresse`, `numeroContribuable`, `notes`. Les accents, espaces et tirets des en-têtes sont normalisés. Types : PARTICULIER ou ENTREPRISE, sans sensibilité à la casse. Les lignes entièrement vides sont ignorées. Les téléphones et identifiants doivent être du texte pour conserver leurs zéros initiaux.

Limites : 2 Mio compressés, 16 Mio décompressés (tailles déclarées et flux réel), 100 entrées ZIP, 1000 lignes de données, 7 colonnes, 5000 caractères/cellule, profondeur XML 64 et 100000 balises/XML. DTD, macros, liens de classeur externes et formules sont refusés. Les cellules avec formule sont des lignes invalides ; les autres anomalies structurelles invalident le fichier. Aucun contenu n'est extrait sur disque.

## Contrats

- `POST /api/clients/import/preview`, multipart `file`. Authentification JWT et rôle AVOCAT actif. Retour : lignes normalisées avec état valid/invalid/duplicate, erreurs, totaux, token signé, expiresAt. Aucun client, journal ou autre enregistrement n'est écrit.
- `POST /api/clients/import/confirm`, multipart `file`, `token`, `confirmed=true`. Même fichier binaire et même utilisateur ; expiration 15 minutes. Le fichier est relu et la base revérifiée. Les lignes non éligibles lors de la prévisualisation ne peuvent pas devenir importables silencieusement.
- Une confirmation valide importe les lignes valides uniquement. Les invalides et doublons sont explicitement ignorés et rapportés. Toute erreur d'écriture annule le lot complet ; il n'y a pas de reprise partielle silencieuse.
- Le rejeu du même jeton non expiré retourne le rapport déjà enregistré. Une nouvelle prévisualisation d'un fichier déjà confirmé est refusée (409). Si la réponse réseau est perdue, réessayer la même confirmation, sans modifier le fichier.

## Déduplication et atomicité

Comparaison conservatrice sur type + nom normalisé, email normalisé ou numéro contribuable normalisé. Pas de fusion ni d'écrasement ; les homonymes doivent être traités manuellement. Aucun rapprochement flou. Les identités historiques sont vérifiées en une requête SQL paramétrée ; les identités d'import sont vérifiées en un lot. Aucun SELECT par ligne.

Les confirmations utilisent une transaction Serializable et un verrou PostgreSQL transactionnel commun aux imports, compatible avec plusieurs workers et le pooling. Clients, identités uniques, journaux d'audit et rapport sont enregistrés dans cette même transaction par opérations groupées. Les créations manuelles existantes n'utilisent pas ce protocole : elles ne sont pas transformées en système de déduplication global.

## Déploiement manuel

Ne pas exécuter automatiquement la migration. Faire valider et appliquer les migrations P1 et `20261027010000_add_client_import_ledger` avant déploiement. Cette dernière ajoute seulement ClientImport, ClientImportIdentity, index et clés étrangères ; aucune modification ni suppression de client historique. Régénérer Prisma. Conserver JWT_SECRET identique entre les workers ; sa rotation invalide les confirmations en attente.

Le journal conserve les rapports pour l'idempotence : sa politique de rétention doit être définie par le cabinet. La limite de validité du jeton ne supprime aucun client ni rapport. Il faut conserver les identités d'import si l'on veut maintenir la protection durable contre la réimportation.

## Vérifications

TypeScript API/front, suites Jest sans cache, tests Node frontend. Les tests HTTP de contrôleur utilisent les vrais intercepteurs multipart et RolesGuard, avec une authentification simulée uniquement dans les tests. Les tests transactionnels simulent la frontière de transaction ; une recette PostgreSQL isolée reste nécessaire pour vérifier les migrations et la concurrence réelles. Aucun test ne doit écrire sur la base métier.
