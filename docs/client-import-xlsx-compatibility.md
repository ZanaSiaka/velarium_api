# Compatibilité XLSX de l'import Clients

## Diagnostic et reproduction

L'ancien contrôle dans `client-workbook.ts` ne positionnait `validContentType` que si :

```ts
name === 'Override' && attrs.PartName === '/xl/workbook.xml' &&
attrs.ContentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
```

Puis `if (!validContentType) bad('Un classeur .xlsx standard est requis.');` interrompait la lecture avant les cellules. Cette condition confondait le type autorisé avec une représentation particulière du paquet.

Avant correction, les nouveaux tests reproduisent exactement ce message avec un type déclaré via `Default` et avec un classeur localisé à la racine via `_rels/.rels`. Un troisième test échoue sur la feuille quand le préfixe d'attribut est `rel:id` au lieu de `r:id`, bien que l'URI de namespace soit identique. Résultat de reproduction : 3 échecs, 21 réussites. Les fichiers openpyxl standards passent déjà avant correction : il ne faut pas attribuer le problème à tous les fichiers de ce producteur.

Le fichier initialement rejeté n'a pas été fourni : la branche responsable du message et les restrictions erronées sont identifiées et reproduites, mais sa variante précise reste à vérifier sur un exemplaire de ce fichier.

## Correction limitée au lecteur

- Localiser le classeur depuis la relation `officeDocument` du paquet, puis la feuille depuis sa relation de classeur.
- Résoudre les types selon `Override`, prioritaire, puis `Default` par extension. Reconnaître la casse des types MIME et des clés de type conformément à leur rôle.
- Résoudre les parties XML internes sans imposer les répertoires `xl/worksheets`, et les chaînes partagées depuis leur relation.
- Utiliser l'URI de namespace de l'attribut d'identifiant au lieu d'imposer le préfixe littéral `r:`; reconnaître les relations OOXML Transitional et Strict.
- Distinguer les erreurs de type manquant, type interdit, relation absente ou ambiguë et partie introuvable.

La résolution par relations et la distinction `Default`/`Override` sont décrites dans les [conventions OPC de Microsoft](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/opc/open-packaging-conventions-overview). Le [lecteur openpyxl](https://openpyxl.readthedocs.io/en/stable/_modules/openpyxl/reader/excel.html) prévoit également le cas où le type de classeur est porté par `Default`.

## Compatibilité vérifiée et limites de la recette

- Deux véritables fichiers produits par **openpyxl 3.1.5**, mode normal et `write_only`, avec les sept colonnes. Les fichiers binaires de test et leur générateur sont dans `src/modules/clients/import/__fixtures__/`. Les tests Jest n'exigent pas Python.
- Paquets minimaux compatibles avec les représentations usuelles Excel/LibreOffice : chaînes inline et partagées, texte enrichi, cibles de feuille absolues ou relatives, préfixes XML équivalents et relations Strict.
- Variantes OPC valides : type via `Default`, parties situées à la racine, table de chaînes partagées dans un autre répertoire.
- Excel et LibreOffice n'ont pas été exécutés pendant cette intervention. Les cas synthétiques ne constituent pas une recette native de toutes leurs versions ou fonctionnalités. Le téléphone et le numéro contribuable doivent toujours être des cellules texte.

## Protections conservées

Les limites restent 2 Mio compressés, 16 Mio décompressés (déclarés et réellement lus), 100 entrées ZIP, 1000 lignes de données, 7 colonnes, 5000 caractères par cellule, profondeur XML 64 et 100000 balises par document. Lecture séquentielle yauzl, aucune extraction sur disque, validation des tailles et refus des archives chiffrées ou chemins ZIP dangereux conservés.

Les cibles de relations sont normalisées à l'intérieur du paquet : chemins sortants, URL externes et adresses invalides sont refusés. Les types de classeurs avec macros restent interdits, y compris via `Default` et pour un binaire renommé. Une déclaration binaire inutilisée reste autorisée, comme auparavant. Les formules rendent la ligne invalide et ne sont jamais évaluées; les résultats en cache ne permettent pas d'importer la ligne. DTD et entités externes restent interdites. Les identifiants de relations ambigus sont refusés.

Les permissions, services métier, jetons, transactions, DTO, frontend, dépendances et migrations n'ont pas été modifiés. Tous les tests de prévisualisation utilisent des mocks, sans import réel ni écriture PostgreSQL.

## Résultats finaux

- TypeScript backend et frontend : réussis (`--noEmit --incremental false`).
- Jest backend complet sans cache : 12 suites, **193/193 tests réussis** (168 avant intervention).
- Tests frontend P0/P1/P2 : **61/61 réussis**.
- `git diff --check` réussi dans les deux projets; avertissements LF/CRLF préexistants sur deux tests Auth. Les nouveaux fichiers texte, encore non suivis comme le reste de P2, ont également été vérifiés pour les espaces finaux et marqueurs de conflit.
- Aucune migration, connexion PostgreSQL métier, importation réelle, installation de dépendance, commit ou push.

Un processus NestJS déjà lancé sans surveillance doit être redémarré pour charger cette correction. Il n'a pas été redémarré pendant la recette afin de ne pas déclencher de traitements de démarrage sur la base métier.
