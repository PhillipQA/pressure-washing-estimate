// Minimal static file server for the end-to-end tests (no dependencies).
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const port = Number(process.argv[2]) || 4173;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

http
  .createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(req.url.split("?")[0]);
    } catch (e) {
      res.writeHead(400);
      return res.end("Bad request");
    }
    const file = path.normalize(path.join(root, urlPath === "/" ? "index.html" : urlPath));
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end("Not found");
      }
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      res.end(data);
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`Serving ${root} at http://127.0.0.1:${port}/`));
