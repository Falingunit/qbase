const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.SNIP_SERVER_PORT || 3030);
const UTILS_ROOT = path.resolve(__dirname, "..");
const DOCS_ROOT = path.join(UTILS_ROOT, "PDF Screenshots");
const SCREENSHOT_HTML = path.join(UTILS_ROOT, "Screenshots.htm");
const PAGE_RE = /^page_\d+\.(png|jpg|jpeg|webp)$/i;
const ALLOWED_EXT_RE = /\.(png|jpg|jpeg|webp)$/i;
const SESSION_FILE = "selections.json";
const LEGACY_SESSION_FILE = ".sniplab.selections.json";

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function toPosix(relPath) {
  return String(relPath || "").replace(/\\/g, "/");
}

function safeJoin(base, relPath) {
  const abs = path.resolve(base, relPath);
  if (!abs.startsWith(path.resolve(base))) return null;
  return abs;
}

function listSnipDocuments() {
  const docs = [];
  if (!fs.existsSync(DOCS_ROOT)) return docs;

  function walk(absDir) {
    let entries = [];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    const subdirs = entries.filter((e) => e.isDirectory());
    const pageFiles = entries
      .filter((e) => e.isFile() && PAGE_RE.test(e.name))
      .map((e) => e.name)
      .sort(naturalCompare);

    if (subdirs.length === 0 && pageFiles.length > 0) {
      const relPath = toPosix(path.relative(DOCS_ROOT, absDir));
      docs.push({
        id: relPath,
        name: path.basename(absDir),
        relativePath: relPath,
        absPath: absDir,
        pageCount: pageFiles.length,
        pageFiles,
      });
      return;
    }

    for (const sub of subdirs) {
      walk(path.join(absDir, sub.name));
    }
  }

  walk(DOCS_ROOT);
  docs.sort((a, b) => naturalCompare(a.relativePath, b.relativePath));
  return docs;
}

function getDocById(docId) {
  return listSnipDocuments().find((d) => d.id === docId);
}

function parseJsonBody(req, maxBytes = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      try {
        const obj = raw ? JSON.parse(raw) : {};
        resolve(obj);
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendFile(res, absPath) {
  fs.stat(absPath, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, 404, { error: "Not found" });

    const ext = path.extname(absPath).toLowerCase();
    const type =
      ext === ".png"
        ? "image/png"
        : ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
        ? "image/webp"
        : ext === ".htm" || ext === ".html"
        ? "text/html; charset=utf-8"
        : "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": st.size,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    });
    fs.createReadStream(absPath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname;

  if (pathname === "/healthz") return sendJson(res, 200, { ok: true });

  if (pathname === "/api/snip-docs") {
    const documents = listSnipDocuments().map((d) => ({
      id: d.id,
      name: d.name,
      relativePath: d.relativePath,
      pageCount: d.pageCount,
    }));
    return sendJson(res, 200, { documents });
  }

  if (pathname === "/api/snip-docs/pages") {
    const docId = String(reqUrl.searchParams.get("doc") || "").trim();
    if (!docId) {
      return sendJson(res, 400, { error: "Query parameter 'doc' is required" });
    }

    const doc = getDocById(docId);
    if (!doc) return sendJson(res, 404, { error: "Document not found" });

    const pages = doc.pageFiles
      .filter((f) => ALLOWED_EXT_RE.test(f))
      .map((name, idx) => ({
        index: idx,
        name,
        url: `${reqUrl.origin}/snip-doc-files/${doc.relativePath
          .split("/")
          .map((p) => encodeURIComponent(p))
          .join("/")}/${encodeURIComponent(name)}`,
      }));

    return sendJson(res, 200, {
      document: {
        id: doc.id,
        name: doc.name,
        relativePath: doc.relativePath,
      },
      pages,
    });
  }

  if (pathname === "/api/snip-docs/session") {
    const docId = String(reqUrl.searchParams.get("doc") || "").trim();
    if (!docId) {
      return sendJson(res, 400, { error: "Query parameter 'doc' is required" });
    }
    const doc = getDocById(docId);
    if (!doc) return sendJson(res, 404, { error: "Document not found" });
    const sessionPath = path.join(doc.absPath, SESSION_FILE);
    const legacySessionPath = path.join(doc.absPath, LEGACY_SESSION_FILE);

    if (req.method === "GET") {
      const readPath = fs.existsSync(sessionPath)
        ? sessionPath
        : fs.existsSync(legacySessionPath)
        ? legacySessionPath
        : null;
      if (!readPath) return sendJson(res, 200, { session: null });
      try {
        const raw = fs.readFileSync(readPath, "utf8");
        const session = raw ? JSON.parse(raw) : null;
        return sendJson(res, 200, { session });
      } catch {
        return sendJson(res, 500, { error: "Failed to read session file" });
      }
    }

    if (req.method === "PUT" || req.method === "POST") {
      try {
        const body = await parseJsonBody(req);
        const session = body?.session ?? null;
        const payload = JSON.stringify(session, null, 2);
        const tempPath = `${sessionPath}.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(tempPath, payload, "utf8");
        fs.renameSync(tempPath, sessionPath);
        return sendJson(res, 200, { success: true });
      } catch (e) {
        const msg = e?.message || "";
        if (msg.includes("Payload too large") || msg.includes("Invalid JSON")) {
          return sendJson(res, 400, { error: msg });
        }
        return sendJson(res, 500, { error: "Failed to write session file" });
      }
    }

    return sendJson(res, 405, { error: "Method not allowed" });
  }

  if (pathname.startsWith("/snip-doc-files/")) {
    const rel = decodeURIComponent(pathname.slice("/snip-doc-files/".length));
    const abs = safeJoin(DOCS_ROOT, rel);
    if (!abs || !ALLOWED_EXT_RE.test(abs)) {
      return sendJson(res, 400, { error: "Invalid file path" });
    }
    return sendFile(res, abs);
  }

  if (pathname === "/" || pathname === "/Screenshots.htm") {
    return sendFile(res, SCREENSHOT_HTML);
  }

  return sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`SnipDoc server listening on http://localhost:${PORT}`);
});
