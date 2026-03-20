import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import WordExtractor from "word-extractor";
import cors from "cors";
import { sql } from "@vercel/postgres";

async function startServer() {
  console.log("Starting server.ts...");
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(cors());

  app.get("/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

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

  // API Router
  const apiRouter = express.Router();

  apiRouter.get("/db-status", (req, res) => {
    console.log("API: GET /db-status");
    res.json({ 
      isPostgresAvailable,
      type: isPostgresAvailable ? 'postgres' : 'none'
    });
  });

  apiRouter.get("/documents", async (req, res) => {
    console.log("API: GET /documents");
    if (!isPostgresAvailable) return res.status(404).json({ error: "Postgres not available" });
    try {
      const { rows } = await sql`SELECT * FROM documents ORDER BY createdAt DESC`;
      res.json(rows);
    } catch (err) {
      console.error("Error fetching documents:", err);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  apiRouter.post("/documents", async (req, res) => {
    console.log("API: POST /documents");
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

  apiRouter.post("/extract-text", async (req, res) => {
    console.log("API: POST /extract-text");
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

  app.use("/api", apiRouter);

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
