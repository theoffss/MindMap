const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5010;
const DIST_DIR = path.join(__dirname, 'dist');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // Extract path without query parameters
  const urlPath = req.url.split('?')[0];
  let decodedUrl;
  try {
    decodedUrl = decodeURIComponent(urlPath);
  } catch (e) {
    res.statusCode = 400;
    res.end('Bad Request: Malformed URI');
    return;
  }

  let filePath = path.join(DIST_DIR, decodedUrl === '/' ? 'index.html' : decodedUrl);

  // Prevent directory traversal
  if (!filePath.startsWith(DIST_DIR)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  let contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // SPA Routing fallback
        fs.readFile(path.join(DIST_DIR, 'index.html'), (errIndex, contentIndex) => {
          if (errIndex) {
            res.statusCode = 500;
            res.end('Error loading index.html');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(contentIndex, 'utf-8');
          }
        });
      } else {
        res.statusCode = 500;
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
