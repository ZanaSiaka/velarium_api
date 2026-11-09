import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { IMPORT_LIMITS, readClientWorkbook } from './client-workbook';
import { upload, uploadFiles, workbookFiles } from './client-import.fixtures';

describe('bounded XLSX client reader', () => {
  const enterprise = ['ENTREPRISE', 'Cabinet Test', 'contact@example.test', '00123456', 'Conakry', '001122', 'Note de test'];
  const expected = { type: enterprise[0], nom: enterprise[1], email: enterprise[2], telephone: enterprise[3], adresse: enterprise[4], numeroContribuable: enterprise[5], notes: enterprise[6] };
  it.each(['openpyxl.xlsx', 'openpyxl-write-only.xlsx'])('reads all seven columns from real %s output', async (name) => {
    const buffer = readFileSync(join(__dirname, '__fixtures__', name));
    const rows = await readClientWorkbook({ originalname: name, buffer, size: buffer.length });
    expect(rows).toEqual([{ line: 2, cells: expected, issues: [] }]);
  });
  it('resolves a workbook content type declared by extension instead of Override', async () => {
    const files = workbookFiles([enterprise]);
    files['[Content_Types].xml'] = files['[Content_Types].xml'].replace('<Default Extension="xml" ContentType="application/xml"/>', '').replace('<Override PartName="/xl/workbook.xml"', '<Default Extension="xml"');
    expect((await readClientWorkbook(uploadFiles(files)))[0].cells).toEqual(expected);
  });
  it('finds the workbook and worksheet through package relationships, not fixed xl paths', async () => {
    const files = workbookFiles([enterprise]);
    files['_rels/.rels'] = files['_rels/.rels'].replace('xl/workbook.xml', 'workbook.xml');
    files['[Content_Types].xml'] = files['[Content_Types].xml'].replace('/xl/workbook.xml', '/workbook.xml').replace('/xl/worksheets/sheet1.xml', '/sheet1.xml');
    files['workbook.xml'] = files['xl/workbook.xml']; delete files['xl/workbook.xml'];
    files['_rels/workbook.xml.rels'] = files['xl/_rels/workbook.xml.rels'].replace('worksheets/sheet1.xml', 'sheet1.xml'); delete files['xl/_rels/workbook.xml.rels'];
    files['sheet1.xml'] = files['xl/worksheets/sheet1.xml']; delete files['xl/worksheets/sheet1.xml'];
    expect((await readClientWorkbook(uploadFiles(files)))[0].cells).toEqual(expected);
  });
  it('accepts an equivalent relationship namespace prefix', async () => {
    const files = workbookFiles([enterprise]);
    files['xl/workbook.xml'] = files['xl/workbook.xml'].replace('xmlns:r=', 'xmlns:rel=').replace('r:id=', 'rel:id=');
    expect((await readClientWorkbook(uploadFiles(files)))[0].cells).toEqual(expected);
  });
  it('reads shared strings and absolute worksheet targets as used by spreadsheet producers', async () => {
    const files = workbookFiles([enterprise]);
    files['xl/_rels/workbook.xml.rels'] = files['xl/_rels/workbook.xml.rels'].replace('Target="worksheets/sheet1.xml"', 'Target="/xl/worksheets/sheet1.xml"').replace('</Relationships>', '<Relationship Id="strings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="text/strings.xml"/></Relationships>');
    files['xl/text/strings.xml'] = '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><r><t>Cabinet </t></r><r><t>Test</t></r></si></sst>';
    files['xl/worksheets/sheet1.xml'] = files['xl/worksheets/sheet1.xml'].replace('<c r="B2" t="inlineStr"><is><t>Cabinet Test</t></is></c>', '<c r="B2" t="s"><v>0</v></c>');
    expect((await readClientWorkbook(uploadFiles(files)))[0].cells).toEqual(expected);
  });
  it('accepts Strict OOXML relationship namespaces', async () => {
    const files = workbookFiles([enterprise]);
    for (const name of Object.keys(files)) files[name] = files[name].replace(/http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/relationships/g, 'http://purl.oclc.org/ooxml/officeDocument/relationships').replace(/http:\/\/schemas.openxmlformats.org\/spreadsheetml\/2006\/main/g, 'http://purl.oclc.org/ooxml/spreadsheetml/main');
    expect((await readClientWorkbook(uploadFiles(files)))[0].cells).toEqual(expected);
  });
  it('gives a specific error for a missing workbook content type', async () => {
    const files = workbookFiles([enterprise]);
    files['[Content_Types].xml'] = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';
    await expect(readClientWorkbook(uploadFiles(files))).rejects.toThrow('Le type du classeur manque');
  });
  it('does not fall back to a benign Default over a forbidden workbook Override', async () => {
    const files = workbookFiles([enterprise]);
    files['[Content_Types].xml'] = files['[Content_Types].xml'].replace('ContentType="application/xml"', 'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"').replace('PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"', 'PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml"');
    await expect(readClientWorkbook(uploadFiles(files))).rejects.toThrow('Le type déclaré');
  });
  it('rejects a renamed macro payload declared via Default', async () => {
    const files = workbookFiles([enterprise]);
    files['[Content_Types].xml'] = files['[Content_Types].xml'].replace('</Types>', '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>');
    files['xl/payload.bin'] = 'not retained as XML';
    await expect(readClientWorkbook(uploadFiles(files))).rejects.toThrow('macros');
  });
  it.each(['_rels/.rels', 'xl/_rels/workbook.xml.rels'])('rejects DTD in %s', async (name) => {
    const files = workbookFiles([enterprise]);
    files[name] = '<!DOCTYPE Relationships [<!ENTITY x SYSTEM "file:///secret">]>' + files[name];
    await expect(readClientWorkbook(uploadFiles(files))).rejects.toThrow('DTD');
  });
  it.each(['../../outside.xml', 'https://example.invalid/sheet.xml', '//example.invalid/sheet.xml', '..%2F..%2Foutside.xml'])('rejects an unsafe worksheet target %s', async (target) => {
    const files = workbookFiles([enterprise]);
    files['xl/_rels/workbook.xml.rels'] = files['xl/_rels/workbook.xml.rels'].replace('worksheets/sheet1.xml', target);
    await expect(readClientWorkbook(uploadFiles(files))).rejects.toThrow(BadRequestException);
  });
  it('rejects external package and shared-string relationships', async () => {
    for (const name of ['_rels/.rels', 'xl/_rels/workbook.xml.rels']) {
      const files = workbookFiles([enterprise]);
      files[name] = files[name].replace('</Relationships>', '<Relationship Id="external" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" TargetMode="External" Target="https://example.invalid/strings.xml"/></Relationships>');
      await expect(readClientWorkbook(uploadFiles(files))).rejects.toThrow('liens externes');
    }
  });
  it('rejects ambiguous relationship IDs', async () => {
    const files = workbookFiles([enterprise]);
    files['xl/_rels/workbook.xml.rels'] = files['xl/_rels/workbook.xml.rels'].replace('</Relationships>', '<Relationship Id="rId1" Target="worksheets/sheet2.xml"/></Relationships>');
    await expect(readClientWorkbook(uploadFiles(files))).rejects.toThrow('répété');
  });
  it('rejects a workbook declared as macro-enabled through Default', async () => {
    const files = workbookFiles([enterprise]);
    files['[Content_Types].xml'] = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>';
    await expect(readClientWorkbook(uploadFiles(files))).rejects.toThrow('macros');
  });
  it('still invalidates formulas in a workbook using a Default content type', async () => {
    const files = workbookFiles([['PARTICULIER', { formula: 'WEBSERVICE("https://example.invalid")' }]]);
    files['[Content_Types].xml'] = files['[Content_Types].xml'].replace('<Default Extension="xml" ContentType="application/xml"/>', '').replace('<Override PartName="/xl/workbook.xml"', '<Default Extension="xml"');
    expect((await readClientWorkbook(uploadFiles(files)))[0].issues.join(' ')).toContain('Formule');
  });
  it('keeps the cell text length limit', async () => {
    await expect(readClientWorkbook(upload([['PARTICULIER', 'x'.repeat(IMPORT_LIMITS.cellLength + 1)]]))).rejects.toThrow('5 000 caractères');
  });
  it('keeps the XML nesting limit', async () => {
    const files = workbookFiles([enterprise]);
    files['_rels/.rels'] = '<x>'.repeat(65) + '</x>'.repeat(65);
    await expect(readClientWorkbook(uploadFiles(files))).rejects.toThrow('trop complexe');
  });
  it('keeps the XML node count limit', async () => {
    const files = workbookFiles([enterprise]);
    files['_rels/.rels'] = '<Relationships>' + '<x/>'.repeat(100000) + '</Relationships>';
    await expect(readClientWorkbook(uploadFiles(files))).rejects.toThrow('trop complexe');
  });
  it('keeps the 100 ZIP entry limit', async () => {
    const files = workbookFiles([enterprise]);
    for (let n = 0; n < IMPORT_LIMITS.entries; n++) files['padding/' + n + '.txt'] = '';
    await expect(readClientWorkbook(uploadFiles(files))).rejects.toThrow(BadRequestException);
  });
  it('reads inline strings without losing textual phone zeros', async () => {
    const rows = await readClientWorkbook(upload([['PARTICULIER', ' Alice ', '', '001234']]));
    expect(rows[0].cells).toMatchObject({ nom: 'Alice', telephone: '001234' });
  });
  it('accepts an unused binary content-type declaration in a standard XLSX', async () => {
    const files = workbookFiles([['PARTICULIER', 'Alice']]);
    files['[Content_Types].xml'] = files['[Content_Types].xml'].replace('</Types>', '<Default Extension="bin" ContentType="application/vnd.ms-excel.sheet.binary.macroEnabled.main"/></Types>');
    expect((await readClientWorkbook(uploadFiles(files)))[0].cells.nom).toBe('Alice');
  });
  it('reads shared strings and rich text', async () => {
    const files = workbookFiles([['PARTICULIER', 'Alice']]);
    files['xl/sharedStrings.xml'] = '<sst><si><r><t>Al</t></r><r><t>ice</t></r></si></sst>';
    files['xl/worksheets/sheet1.xml'] = files['xl/worksheets/sheet1.xml'].replace('<c r="B2" t="inlineStr"><is><t>Alice</t></is></c>', '<c r="B2" t="s"><v>0</v></c>');
    expect((await readClientWorkbook(uploadFiles(files)))[0].cells.nom).toBe('Alice');
  });
  it.each([undefined, { originalname: 'fake.xlsx', size: 1, buffer: Buffer.from('x') }, { originalname: 'fake.xls', size: 4, buffer: Buffer.from('PKxx') }])('rejects an invalid file %p', async (file) => {
    await expect(readClientWorkbook(file)).rejects.toThrow(BadRequestException);
  });
  it('rejects oversized input before decompression', async () => {
    await expect(readClientWorkbook({ originalname: 'clients.xlsx', size: IMPORT_LIMITS.bytes + 1, buffer: Buffer.alloc(IMPORT_LIMITS.bytes + 1) })).rejects.toThrow(BadRequestException);
  });
  it('rejects a compressed expansion bomb', async () => {
    const files = workbookFiles([['PARTICULIER', 'Alice']]); files['padding.txt'] = 'x'.repeat(IMPORT_LIMITS.expanded + 1);
    await expect(readClientWorkbook(uploadFiles(files))).rejects.toThrow(BadRequestException);
  });
  it.each([['nom'], ['type'], ['type', 'nom', 'inconnu'], ['type', 'nom', 'nom']])('rejects missing or invalid headers %p', async (...headers) => {
    await expect(readClientWorkbook(upload([['PARTICULIER', 'Alice']], headers as string[]))).rejects.toThrow(BadRequestException);
  });
  it('accepts French headers without accents ambiguity', async () => {
    const rows = await readClientWorkbook(upload([['ENTREPRISE', 'Cabinet', 'CI123']], ['type', 'nom', 'Numéro contribuable']));
    expect(rows[0].cells.numeroContribuable).toBe('CI123');
  });
  it('marks formulas invalid without evaluating cached results', async () => {
    const rows = await readClientWorkbook(upload([['PARTICULIER', { formula: 'WEBSERVICE("https://example.invalid")' }]]));
    expect(rows[0].issues.join(' ')).toContain('Formule');
  });
  it('rejects numeric phone and tax cells to avoid losing leading zeros', async () => {
    const rows = await readClientWorkbook(upload([['ENTREPRISE', 'Cabinet', '', { number: 123 }]]));
    expect(rows[0].issues.join(' ')).toContain('cellules texte');
  });
  it('rejects more than 1000 data rows', async () => {
    await expect(readClientWorkbook(upload(Array.from({ length: 1001 }, (_, n) => ['PARTICULIER', 'Name ' + n])))).rejects.toThrow(BadRequestException);
  });
  it('rejects sparse out-of-range row indices', async () => {
    const files = workbookFiles([['PARTICULIER', 'Alice']]); files['xl/worksheets/sheet1.xml'] = files['xl/worksheets/sheet1.xml'].replace('r="2"', 'r="1048576"');
    await expect(readClientWorkbook(uploadFiles(files))).rejects.toThrow(BadRequestException);
  });
  it('rejects DTD and entity declarations', async () => {
    const files = workbookFiles([['PARTICULIER', 'Alice']]); files['xl/workbook.xml'] = '<!DOCTYPE workbook [<!ENTITY x SYSTEM "file:///secret">]>' + files['xl/workbook.xml'];
    await expect(readClientWorkbook(uploadFiles(files))).rejects.toThrow(BadRequestException);
  });
  it('rejects macros and external workbook links', async () => {
    const files = workbookFiles([['PARTICULIER', 'Alice']]); files['xl/vbaProject.bin'] = 'macro';
    await expect(readClientWorkbook(uploadFiles(files))).rejects.toThrow(BadRequestException);
    delete files['xl/vbaProject.bin']; files['xl/_rels/workbook.xml.rels'] = files['xl/_rels/workbook.xml.rels'].replace('Target="', 'TargetMode="External" Target="');
    await expect(readClientWorkbook(uploadFiles(files))).rejects.toThrow(BadRequestException);
  });
});
