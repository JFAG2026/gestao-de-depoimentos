import initSqlJs, { Database } from 'sql.js';

let db: Database | null = null;
let SQL: any = null;

const SQLITE_WASM_URL = 'https://sql.js.org/dist/sql-wasm.wasm';

export const initDatabase = async (existingData?: Uint8Array): Promise<Database> => {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: () => SQLITE_WASM_URL
    });
  }
  
  db = new SQL.Database(existingData);
  
  // Create tables if they don't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      fileName TEXT,
      folderName TEXT,
      fileType TEXT,
      rawText TEXT,
      isAudio INTEGER,
      topics TEXT,
      audioSegments TEXT,
      personName TEXT,
      date TEXT,
      presidingEntity TEXT,
      phase TEXT,
      createdAt TEXT
    )
  `);
  
  return db;
};

export const getDb = () => db;

export const saveDocumentToDb = (doc: any) => {
  if (!db) return;
  
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO documents (
      id, fileName, folderName, fileType, rawText, isAudio, 
      topics, audioSegments, personName, date, presidingEntity, phase, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run([
    doc.id,
    doc.fileName,
    doc.folderName,
    doc.fileType,
    doc.rawText,
    doc.isAudio ? 1 : 0,
    JSON.stringify(doc.topics || []),
    JSON.stringify(doc.audioSegments || []),
    doc.personName || null,
    doc.date || null,
    doc.presidingEntity || null,
    doc.phase || '',
    doc.createdAt
  ]);
  stmt.free();
};

export const getAllDocumentsFromDb = (): any[] => {
  if (!db) return [];
  
  const res = db.exec("SELECT * FROM documents");
  if (res.length === 0) return [];
  
  const columns = res[0].columns;
  const values = res[0].values;
  
  return values.map(row => {
    const doc: any = {};
    columns.forEach((col, i) => {
      if (col === 'isAudio') {
        doc[col] = row[i] === 1;
      } else if (col === 'topics' || col === 'audioSegments') {
        doc[col] = JSON.parse(row[i] as string);
      } else {
        doc[col] = row[i];
      }
    });
    return doc;
  });
};

export const exportDbBinary = (): Uint8Array | null => {
  if (!db) return null;
  return db.export();
};
