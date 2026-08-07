import express from 'express';
import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Increase payload limit for base64 images
  app.use(express.json({ limit: '50mb' }));

  // Health check route for AWS App Runner
  app.get('/api/health', (req, res) => {
    res.status(200).send('OK');
  });

  // Export full App as a ZIP archive
  app.get('/api/download-zip', (req, res) => {
    try {
      const zip = new AdmZip();
      const rootPath = process.cwd();

      const addFilesRecursively = (dir: string, zipPath: string) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const relativeZipPath = path.join(zipPath, file).replace(/\\/g, '/'); // ensure unix paths inside zip

          // Exclude build outputs, node modules, git, and zip files themselves
          if (file === 'node_modules' || file === 'dist' || file === '.git' || file === 'tmp' || file === '.cache') {
            continue;
          }
          if (file.endsWith('.zip')) {
            continue;
          }

          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            addFilesRecursively(fullPath, relativeZipPath);
          } else {
            zip.addFile(relativeZipPath, fs.readFileSync(fullPath));
          }
        }
      };

      addFilesRecursively(rootPath, '');
      const buffer = zip.toBuffer();

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename=kavach_design_studio.zip');
      res.send(buffer);
    } catch (err: any) {
      console.error('Failed to generate zip file', err);
      res.status(500).json({ error: 'Failed to generate zip file', details: err?.message || String(err) });
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
    // For Express 4.x we use *
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

startServer();
