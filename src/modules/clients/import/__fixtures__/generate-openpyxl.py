"""Regenerate local test workbooks with openpyxl 3.1.5; no database access."""
from pathlib import Path
from openpyxl import Workbook

HEADERS = ['type', 'nom', 'email', 'telephone', 'adresse', 'numeroContribuable', 'notes']
ROW = ['ENTREPRISE', 'Cabinet Test', 'contact@example.test', '00123456', 'Conakry', '001122', 'Note de test']

for write_only in (False, True):
    workbook = Workbook(write_only=write_only)
    sheet = workbook.create_sheet('Clients') if write_only else workbook.active
    sheet.title = 'Clients'
    sheet.append(HEADERS)
    sheet.append(ROW)
    filename = 'openpyxl-write-only.xlsx' if write_only else 'openpyxl.xlsx'
    workbook.save(Path(__file__).parent / filename)
