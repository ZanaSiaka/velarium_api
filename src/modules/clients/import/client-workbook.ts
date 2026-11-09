import { BadRequestException } from '@nestjs/common';
import * as yauzl from 'yauzl';
import * as sax from 'sax';
import { posix } from 'path';

export const IMPORT_LIMITS = { bytes: 2 * 1024 * 1024, expanded: 16 * 1024 * 1024, entries: 100, rows: 1000, columns: 7, cellLength: 5000 } as const;
export const CLIENT_COLUMNS = ['type', 'nom', 'email', 'telephone', 'adresse', 'numeroContribuable', 'notes'] as const;
export type ClientColumn = typeof CLIENT_COLUMNS[number];
export type RawClientRow = { line: number; cells: Partial<Record<ClientColumn, string>>; issues: string[] };
export type ImportUpload = { originalname: string; buffer: Buffer; size: number };
function bad(message: string): never { throw new BadRequestException(message); }
const local = (name: string) => name.split(':').pop()!;

// ZIP members are read sequentially, with declared AND actual expansion limits; nothing is extracted to disk.
async function readArchive(buffer: Buffer): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error || !zip) return reject(new BadRequestException('Fichier XLSX illisible ou corrompu.'));
      const files = new Map<string, string>();
      const seen = new Set<string>();
      let bytes = 0, declared = 0, entries = 0, failed = false;
      const fail = () => { if (!failed) { failed = true; zip.close(); reject(new BadRequestException('Archive XLSX invalide, chiffrée ou trop volumineuse.')); } };
      zip.on('error', fail);
      zip.on('end', () => { if (!failed) resolve(files); });
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName;
        if (++entries > IMPORT_LIMITS.entries || seen.has(name) || name.startsWith('/') || name.split('/').includes('..') ||
            (entry.generalPurposeBitFlag & 1) || /vbaProject|externalLinks/i.test(name) ||
            (declared += entry.uncompressedSize) > IMPORT_LIMITS.expanded) return fail();
        seen.add(name);
        if (name.endsWith('/')) { zip.readEntry(); return; }
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return fail();
          // OPC relationships locate XML parts; their directory names are not fixed by XLSX.
          const keep = name === '[Content_Types].xml' || /\.(xml|rels)$/i.test(name);
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > IMPORT_LIMITS.expanded) { stream.destroy(); fail(); return; }
            if (keep) chunks.push(chunk);
          });
          stream.on('error', fail);
          // Keep every member name for content-type checks, without retaining binary payloads.
          stream.on('end', () => { if (!failed) { files.set(name, keep ? Buffer.concat(chunks).toString('utf8') : ''); zip.readEntry(); } });
        });
      });
      zip.readEntry();
    });
  });
}

function parseXml(xml: string, open: (name: string, attrs: Record<string, string>) => void, text: (value: string) => void, close: (name: string) => void) {
  const options: sax.SAXOptions & { strictEntities: boolean } = { trim: false, normalize: false, strictEntities: true, xmlns: true };
  const parser = sax.parser(true, options);
  let depth = 0, nodes = 0;
  parser.ondoctype = () => bad('Les DTD et entités externes sont interdites.');
  parser.onerror = () => bad('XML XLSX invalide.');
  parser.onopentag = (node) => {
    if (++depth > 64 || ++nodes > 100000) bad('Structure XLSX trop complexe.');
    const attrs: Record<string, string> = {};
    for (const [name, attr] of Object.entries(node.attributes)) {
      if (typeof attr === 'string') attrs[name] = attr;
      else {
        // The namespace URI identifies a relationship attribute, not the chosen prefix.
        const key = RELATION_NAMESPACES.includes(attr.uri) && attr.local === 'id' ? 'r:id' : name;
        attrs[key] = attr.value;
      }
    }
    open(local(node.name), attrs);
  };
  parser.ontext = text;
  parser.oncdata = text;
  parser.onclosetag = (name) => { close(local(name)); depth--; };
  parser.write(xml).close();
}

const RELATION_NAMESPACES = ['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'http://purl.oclc.org/ooxml/officeDocument/relationships'];
const isRelation = (type: string | undefined, kind: string) => RELATION_NAMESPACES.some((ns) => type === ns + '/' + kind);
const WORKBOOK_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';

function resolvePart(source: string, target: string | undefined): string {
  if (!target) bad('Une relation XLSX ne précise pas sa partie cible.');
  let decoded: string;
  try { decoded = decodeURIComponent(target); } catch { bad('Adresse de partie XLSX invalide.'); }
  if (/^[a-z][a-z\d+.-]*:/i.test(decoded) || decoded.startsWith('//') || /[\\?#\x00-\x1f]/.test(decoded)) bad('Relation XLSX externe ou adresse de partie invalide.');
  const part = posix.normalize(decoded.startsWith('/') ? decoded.slice(1) : posix.join(posix.dirname(source), decoded));
  if (part === '.' || part === '..' || part.startsWith('../') || part.startsWith('/')) bad('Une relation XLSX sort du paquet.');
  return part;
}

function readRelations(files: Map<string, string>, source: string): Record<string, string>[] {
  const path = source ? posix.join(posix.dirname(source), '_rels', posix.basename(source) + '.rels') : '_rels/.rels';
  const xml = files.get(path);
  if (!xml) bad('Relations du classeur XLSX manquantes.');
  const relations: Record<string, string>[] = [];
  const ids = new Set<string>();
  parseXml(xml, (name, attrs) => {
    if (name !== 'Relationship') return;
    if (!attrs.Id || ids.has(attrs.Id)) bad('Identifiant de relation XLSX manquant ou répété.');
    ids.add(attrs.Id);
    if (attrs.TargetMode === 'External' || /externalLink/i.test(attrs.Type || '')) bad('Les liens externes sont interdits.');
    if (/vbaProject|macroEnabled|macrosheet/i.test(attrs.Type || '')) bad('Les classeurs avec macros sont interdits.');
    relations.push(attrs);
  }, () => {}, () => {});
  return relations;
}

export async function readClientWorkbook(file: ImportUpload | undefined): Promise<RawClientRow[]> {
  if (!file || !/\.xlsx$/i.test(file.originalname) || file.size !== file.buffer.length || file.size < 4 || file.size > IMPORT_LIMITS.bytes || file.buffer.readUInt16LE(0) !== 0x4b50) bad('Sélectionnez un fichier .xlsx valide de 2 Mo maximum.');
  try {
    const files = await readArchive(file.buffer);
    const contentTypes = files.get('[Content_Types].xml');
    if (!contentTypes) bad('Type de classeur XLSX manquant.');
    const overrides = new Map<string, string>(), defaults = new Map<string, string>();
    parseXml(contentTypes, (name, attrs) => {
      if (name === 'Override') {
        if (/macroEnabled|vbaProject|macrosheet/i.test(attrs.ContentType || '')) bad('Les classeurs avec macros sont interdits.');
        if (!attrs.PartName?.startsWith('/') || !attrs.ContentType) bad('Déclaration de type XLSX invalide.');
        const part = resolvePart('', attrs.PartName).toLowerCase();
        if (overrides.has(part)) bad('Type de partie XLSX déclaré plusieurs fois.');
        overrides.set(part, attrs.ContentType.toLowerCase());
      }
      if (name === 'Default') {
        if (!attrs.Extension || !attrs.ContentType || defaults.has(attrs.Extension.toLowerCase())) bad('Type d’extension XLSX manquant ou répété.');
        defaults.set(attrs.Extension.toLowerCase(), attrs.ContentType.toLowerCase());
      }
    }, () => {}, () => {});
    const contentType = (part: string) => overrides.get(part.toLowerCase()) ?? defaults.get(posix.extname(part).slice(1).toLowerCase());
    // An unused binary Default is harmless; actual macro parts are still refused.
    for (const part of files.keys()) if (part !== '[Content_Types].xml' && /macroEnabled|vbaProject|macrosheet/i.test(contentType(part) || '')) bad('Les classeurs avec macros sont interdits.');
    const documents = readRelations(files, '').filter((rel) => isRelation(rel.Type, 'officeDocument'));
    if (documents.length !== 1) bad('Le paquet XLSX doit référencer un seul classeur.');
    const workbookPart = resolvePart('', documents[0].Target);
    if (!contentType(workbookPart)) bad('Le type du classeur manque dans [Content_Types].xml.');
    if (contentType(workbookPart) !== WORKBOOK_CONTENT_TYPE) bad('Le type déclaré dans [Content_Types].xml ne correspond pas à un classeur .xlsx sans macros. Réenregistrez le fichier au format Classeur Excel (.xlsx).');
    const workbook = files.get(workbookPart);
    if (!workbook) bad('Le classeur référencé dans le paquet XLSX est introuvable.');
    const relations = readRelations(files, workbookPart);
    const sheets: string[] = [];
    parseXml(workbook, (name, attrs) => { if (name === 'sheet') sheets.push(attrs['r:id']); }, () => {}, () => {});
    if (sheets.length !== 1) bad('Le classeur doit contenir une seule feuille de clients.');
    const sheet = relations.find((rel) => rel.Id === sheets[0]);
    if (!sheet || !isRelation(sheet.Type, 'worksheet')) bad('La relation de la feuille de clients est manquante ou invalide.');
    const worksheet = resolvePart(workbookPart, sheet.Target);
    if (!files.has(worksheet)) bad('Feuille de clients introuvable dans le paquet XLSX.');
    const sharedRelation = relations.find((rel) => isRelation(rel.Type, 'sharedStrings'));
    const sharedPart = sharedRelation ? resolvePart(workbookPart, sharedRelation.Target) : posix.join(posix.dirname(workbookPart), 'sharedStrings.xml');
    if (sharedRelation && !files.has(sharedPart)) bad('Table des chaînes partagées XLSX introuvable.');
    const strings: string[] = [];
    let inString = false, inText = false, value = '';
    if (files.has(sharedPart)) parseXml(files.get(sharedPart)!, (name) => {
      if (name === 'si') { inString = true; value = ''; }
      if (name === 't' && inString) inText = true;
    }, (text) => { if (inText) { value += text; if (value.length > IMPORT_LIMITS.cellLength) bad('Une cellule dépasse 5 000 caractères.'); } }, (name) => {
      if (name === 't') inText = false;
      if (name === 'si') { strings.push(value); inString = false; if (strings.length > 10000) bad('Trop de chaînes dans le fichier.'); }
    });
    const matrix: { line: number; values: Map<number, string>; kinds: Map<number, string>; issues: string[] }[] = [];
    let row: typeof matrix[number] | undefined;
    let column = 0, cellType = '', cellText = '', reading = false, formula = false, cells = 0;
    const rowNumbers = new Set<number>();
    parseXml(files.get(worksheet)!, (name, attrs) => {
      if (name === 'row') {
        const line = Number(attrs.r);
        if (!Number.isInteger(line) || line < 1 || line > IMPORT_LIMITS.rows + 1 || rowNumbers.has(line)) bad('Maximum : 1 000 lignes de données, sans lignes hors plage.');
        rowNumbers.add(line); row = { line, values: new Map(), kinds: new Map(), issues: [] };
      }
      if (name === 'c') {
        const match = /^([A-Z]+)([1-9]\d*)$/.exec(attrs.r || '');
        if (!row || !match || Number(match[2]) !== row.line || ++cells > (IMPORT_LIMITS.rows + 1) * IMPORT_LIMITS.columns) bad('Coordonnées de cellule invalides.');
        column = [...match[1]].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1;
        if (column >= IMPORT_LIMITS.columns || row.values.has(column)) bad('Maximum : 7 colonnes, sans cellule répétée.');
        cellType = attrs.t || 'n'; cellText = ''; formula = false;
      }
      if (name === 'f') formula = true; // Never evaluate or accept cached formula results.
      if (name === 'v' || name === 't') reading = true;
    }, (text) => {
      if (reading) { cellText += text; if (cellText.length > IMPORT_LIMITS.cellLength) bad('Une cellule dépasse 5 000 caractères.'); }
    }, (name) => {
      if (name === 'v' || name === 't') reading = false;
      if (name === 'c' && row) {
        let value = cellText;
        if (cellType === 's') {
          const index = Number(cellText);
          if (!Number.isInteger(index) || strings[index] === undefined) bad('Chaîne partagée invalide.');
          value = strings[index];
        }
        if (formula) row.issues.push('Formule Excel interdite. Remplacez-la par une valeur texte.');
        if (!['s', 'inlineStr', 'str', 'n'].includes(cellType)) row.issues.push('Type de cellule non pris en charge. Utilisez du texte.');
        row.values.set(column, value.trim());
        row.kinds.set(column, cellType);
      }
      if (name === 'row' && row) { matrix.push(row); row = undefined; }
    });
    const header = matrix.find((r) => r.line === 1);
    if (!header || header.issues.length) bad('En-tête manquant ou invalide en ligne 1.');
    const normalizeHeader = (v: string) => v.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[ _-]/g, '').toLowerCase();
    const columns = new Map<number, ClientColumn>();
    for (const [index, value] of header.values) {
      const key = CLIENT_COLUMNS.find((name) => normalizeHeader(name) === normalizeHeader(value));
      if (!key || [...columns.values()].includes(key)) bad('Colonne inconnue ou répétée. Colonnes : ' + CLIENT_COLUMNS.join(', '));
      columns.set(index, key);
    }
    if (!columns.has(0) || ![...columns.values()].includes('type') || ![...columns.values()].includes('nom')) bad('Les colonnes type et nom sont obligatoires.');
    const rows = matrix.filter((r) => r.line !== 1 && (r.issues.length || [...r.values.values()].some(Boolean))).sort((a, b) => a.line - b.line).map((r) => {
      const cells: RawClientRow['cells'] = {};
      for (const [index, value] of r.values) {
        const key = columns.get(index);
        if (!key && value) r.issues.push('Valeur dans une colonne sans en-tête.');
        if (key) cells[key] = value;
        if (value && (key === 'telephone' || key === 'numeroContribuable') && r.kinds.get(index) === 'n') r.issues.push('Téléphone et numéro contribuable : utilisez des cellules texte pour conserver les zéros initiaux.');
      }
      return { line: r.line, cells, issues: r.issues };
    });
    if (!rows.length) bad('Aucune ligne de client à importer.');
    return rows;
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    bad('Fichier XLSX illisible ou corrompu.');
  }
}
