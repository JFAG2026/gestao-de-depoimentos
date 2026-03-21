import initSqlJs, { Database } from 'sql.js';

let db: Database | null = null;
let SQL: any = null;
let dbType: 'sqlite' | 'postgres' = 'sqlite';

const SQLITE_WASM_URL = 'https://sql.js.org/dist/sql-wasm.wasm';

export const initDatabase = async (existingData?: Uint8Array): Promise<Database | null> => {
  try {
    const statusRes = await fetch('/api/db-status');
    const status = await statusRes.json();
    if (status.isPostgresAvailable) {
      dbType = 'postgres';
      console.log("Using server-side Postgres database.");
      return null; // No local DB needed
    }
  } catch (err) {
    console.log("Server-side DB not available, falling back to SQLite.");
  }

  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: () => SQLITE_WASM_URL
    });
  }
  
  db = new SQL.Database(existingData);
  dbType = 'sqlite';
  
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
export const getDbType = () => dbType;

export const saveDocumentToDb = async (doc: any) => {
  if (dbType === 'postgres') {
    try {
      await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc)
      });
    } catch (err) {
      console.error("Error saving to Postgres:", err);
    }
    return;
  }

  if (!db) return;
  
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO documents (
      id, fileName, folderName, fileType, rawText, isAudio, 
      topics, audioSegments, personName, date, presidingEntity, phase, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run([
    doc.id || crypto.randomUUID(),
    doc.fileName || 'Sem nome',
    doc.folderName || 'Raiz',
    doc.fileType || 'resumo',
    doc.rawText || '',
    doc.isAudio ? 1 : 0,
    JSON.stringify(doc.topics || []),
    JSON.stringify(doc.audioSegments || []),
    doc.personName || 'Desconhecido',
    doc.date || 'Desconhecida',
    doc.presidingEntity || 'Desconhecido',
    doc.phase || 'inquerito',
    doc.createdAt || new Date().toISOString()
  ]);
  stmt.free();
};

export const getAllDocumentsFromDb = async (): Promise<any[]> => {
  if (dbType === 'postgres') {
    try {
      const res = await fetch('/api/documents');
      return await res.json();
    } catch (err) {
      console.error("Error fetching from Postgres:", err);
      return [];
    }
  }

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
  if (!db || dbType !== 'sqlite') return null;
  return db.export();
};

export const checkDbIntegrity = (): { ok: boolean; message: string } => {
  if (dbType === 'postgres') return { ok: true, message: "Postgres database managed by server." };
  if (!db) return { ok: false, message: "Database not initialized." };
  
  try {
    const res = db.exec("PRAGMA integrity_check;");
    if (res.length > 0 && res[0].values[0][0] === 'ok') {
      const countRes = db.exec("SELECT COUNT(*) FROM documents;");
      const count = countRes[0].values[0][0];
      return { ok: true, message: `Integridade OK. ${count} documentos na base de dados.` };
    }
    return { ok: false, message: "Erro de integridade detetado." };
  } catch (err: any) {
    return { ok: false, message: "Erro ao verificar: " + err.message };
  }
};
