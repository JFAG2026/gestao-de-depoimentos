import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import WordExtractor from "word-extractor";
import cors from "cors";
import { sql } from "@vercel/postgres";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(cors());

  // Check if Postgres is available
  const isPostgresAvailable = !!process.env.POSTGRES_URL;

  if (isPostgresAvailable) {
    try {
      // Create table if it doesn't exist
      await sql`
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          fileName TEXT,
          folderName TEXT,
          fileType TEXT,
          rawText TEXT,
          isAudio BOOLEAN,
          topics JSONB,
          audioSegments JSONB,
          personName TEXT,
          date TEXT,
          presidingEntity TEXT,
          phase TEXT,
          createdAt TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
      `;
      console.log("Postgres table 'documents' ensured.");
    } catch (err) {
      console.error("Error ensuring Postgres table:", err);
    }
  }

  // API routes
  app.get("/api/db-status", (req, res) => {
    res.json({ 
      isPostgresAvailable,
      type: isPostgresAvailable ? 'postgres' : 'none'
    });
  });

  app.get("/api/documents", async (req, res) => {
    if (!isPostgresAvailable) return res.status(404).json({ error: "Postgres not available" });
    try {
      const { rows } = await sql`SELECT * FROM documents ORDER BY createdAt DESC`;
      res.json(rows);
    } catch (err) {
      console.error("Error fetching documents:", err);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  app.post("/api/documents", async (req, res) => {
    if (!isPostgresAvailable) return res.status(404).json({ error: "Postgres not available" });
    try {
      const doc = req.body;
      await sql`
        INSERT INTO documents (
          id, fileName, folderName, fileType, rawText, isAudio, 
          topics, audioSegments, personName, date, presidingEntity, phase, createdAt
        ) VALUES (
          ${doc.id}, ${doc.fileName}, ${doc.folderName}, ${doc.fileType}, ${doc.rawText}, 
          ${doc.isAudio}, ${JSON.stringify(doc.topics)}, ${JSON.stringify(doc.audioSegments)}, 
          ${doc.personName}, ${doc.date}, ${doc.presidingEntity}, ${doc.phase}, ${doc.createdAt || new Date().toISOString()}
        )
        ON CONFLICT (id) DO UPDATE SET
          fileName = EXCLUDED.fileName,
          folderName = EXCLUDED.folderName,
          fileType = EXCLUDED.fileType,
          rawText = EXCLUDED.rawText,
          isAudio = EXCLUDED.isAudio,
          topics = EXCLUDED.topics,
          audioSegments = EXCLUDED.audioSegments,
          personName = EXCLUDED.personName,
          date = EXCLUDED.date,
          presidingEntity = EXCLUDED.presidingEntity,
          phase = EXCLUDED.phase,
          createdAt = EXCLUDED.createdAt
      `;
      res.json({ success: true });
    } catch (err) {
      console.error("Error saving document:", err);
      res.status(500).json({ error: "Failed to save document" });
    }
  });

  app.post("/api/extract-text", async (req, res) => {
    try {
      const { base64, fileName } = req.body;
      const buffer = Buffer.from(base64, 'base64');
      
      if (fileName.toLowerCase().endsWith('.doc')) {
        const extractor = new WordExtractor();
        const extracted = await extractor.extract(buffer);
        res.json({ text: extracted.getBody() });
      } else {
        res.status(400).json({ error: "Unsupported file type for server-side extraction" });
      }
    } catch (error) {
      console.error("Extraction error:", error);
      res.status(500).json({ error: "Failed to extract text" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
