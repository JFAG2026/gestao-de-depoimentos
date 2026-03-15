import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import WordExtractor from "word-extractor";
import cors from "cors";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(cors());

  // API routes
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
