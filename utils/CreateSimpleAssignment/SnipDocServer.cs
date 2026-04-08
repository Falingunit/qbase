namespace CreateSimpleAssignment
{
    using System.IO.Compression;
    using System.Net;
    using System.Text.Json;
    using System.Text.RegularExpressions;

    public sealed class SnipDocServer
    {
        private readonly HttpListener _listener = new();
        private readonly string _docsRoot;
        private readonly string _htmlPath;
        private readonly string _exportRoot;
        private readonly int _port;

        private readonly Regex _pageRegex = new(@"^page_\d+\.(png|jpg|jpeg|webp)$", RegexOptions.IgnoreCase);
        private readonly Regex _allowedExtRegex = new(@"\.(png|jpg|jpeg|webp)$", RegexOptions.IgnoreCase);

        // Shutdown coordination
        private readonly object _shutdownLock = new();
        private bool _shutdownRequested = false;
        private bool _listenerClosed = false;

        public SnipDocServer(string utilsRoot, string exportRoot, int port = 3030)
        {
            _port = port;
            _docsRoot = Path.Combine(utilsRoot, "PDF Screenshots");
            _htmlPath = Path.Combine(utilsRoot, "Screenshots.htm");
            _exportRoot = Path.GetFullPath(exportRoot);

            Directory.CreateDirectory(_exportRoot);

            _listener.Prefixes.Add($"http://localhost:{port}/");
        }

        public async Task StartAsync()
        {
            _listener.Start();

            while (!IsShutdownRequested())
            {
                HttpListenerContext ctx;

                try
                {
                    // This can block forever unless we Close() the listener.
                    ctx = await _listener.GetContextAsync();
                }
                catch (HttpListenerException)
                {
                    // Thrown when listener is stopped/closed while waiting.
                    break;
                }
                catch (ObjectDisposedException)
                {
                    // Thrown when listener is closed/disposed.
                    break;
                }
                catch
                {
                    break;
                }

                _ = Task.Run(() => Handle(ctx));
            }

            // Ensure listener is no longer running
            RequestShutdown(closeListener: true);
        }

        private bool IsShutdownRequested()
        {
            lock (_shutdownLock) return _shutdownRequested;
        }

        private void RequestShutdown(bool closeListener)
        {
            lock (_shutdownLock)
            {
                _shutdownRequested = true;

                if (closeListener && !_listenerClosed)
                {
                    _listenerClosed = true;
                    try { _listener.Close(); } catch { /* ignore */ }
                }
            }
        }

        private async Task Handle(HttpListenerContext ctx)
        {
            var req = ctx.Request;
            var res = ctx.Response;

            // CORS (handy when opening Screenshots.htm via file://)
            res.AddHeader("Access-Control-Allow-Origin", "*");
            res.AddHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
            res.AddHeader("Access-Control-Allow-Headers", "Content-Type");

            if (req.HttpMethod == "OPTIONS")
            {
                res.StatusCode = 204;
                res.Close();
                return;
            }

            var path = req.Url!.AbsolutePath;

            if (path.StartsWith("/screenshots-assets/", StringComparison.OrdinalIgnoreCase))
            {
                var assetsRoot = Path.Combine(Path.GetDirectoryName(_htmlPath)!, "screenshots-assets");
                var rel = Uri.UnescapeDataString(path["/screenshots-assets/".Length..])
                    .Replace("/", Path.DirectorySeparatorChar.ToString());

                var abs = SafeJoin(assetsRoot, rel);
                if (abs is null || !File.Exists(abs))
                {
                    res.StatusCode = 404;
                    await SendJson(res, new { error = "Asset not found" });
                    return;
                }

                await SendFile(res, abs);
                return;
            }


            try
            {
                if (path == "/" || path == "/Screenshots.htm")
                {
                    await SendFile(res, _htmlPath);
                    return;
                }

                if (path == "/healthz")
                {
                    await SendJson(res, new { ok = true });
                    return;
                }

                if (path == "/api/snip-docs")
                {
                    var docs = ListDocuments()
                        .Select(d => new
                        {
                            id = d.Id,
                            name = d.Name,
                            relativePath = d.RelativePath,
                            pageCount = d.Pages.Count
                        });

                    await SendJson(res, new { documents = docs });
                    return;
                }

                if (path == "/api/snip-docs/pages")
                {
                    var docId = new string(req.QueryString["doc"] ?? "").Trim();
                    if (string.IsNullOrEmpty(docId))
                    {
                        res.StatusCode = 400;
                        await SendJson(res, new { error = "Query parameter 'doc' is required" });
                        return;
                    }

                    var doc = GetDocById(docId);
                    if (doc is null)
                    {
                        res.StatusCode = 404;
                        await SendJson(res, new { error = "Document not found" });
                        return;
                    }

                    var origin = $"{req.Url.Scheme}://{req.Url.Host}:{req.Url.Port}";
                    var pages = doc.Pages
                        .Where(p => _allowedExtRegex.IsMatch(p))
                        .Select((abs, idx) => new
                        {
                            index = idx,
                            name = Path.GetFileName(abs),
                            url = $"{origin}/snip-doc-files/{Uri.EscapeDataString(doc.RelativePath).Replace("%2F", "/")}/{Uri.EscapeDataString(Path.GetFileName(abs))}"
                        });

                    await SendJson(res, new
                    {
                        document = new { id = doc.Id, name = doc.Name, relativePath = doc.RelativePath },
                        pages
                    });
                    return;
                }

                // Receive ZIP from the UI and extract into exportRoot (flat, no subfolders)
                if (path == "/api/snip-docs/export")
                {
                    if (req.HttpMethod != "POST")
                    {
                        res.StatusCode = 405;
                        await SendJson(res, new { error = "Method not allowed" });
                        return;
                    }

                    Directory.CreateDirectory(_exportRoot);

                    using var ms = new MemoryStream();
                    await req.InputStream.CopyToAsync(ms);
                    ms.Position = 0;

                    int saved = 0;

                    using (var zip = new ZipArchive(ms, ZipArchiveMode.Read, leaveOpen: true))
                    {
                        foreach (var entry in zip.Entries)
                        {
                            // skip directories
                            if (string.IsNullOrWhiteSpace(entry.Name))
                                continue;

                            // Flatten: ignore any folders inside the zip
                            var fileName = SanitizeFileName(entry.Name);

                            // Ensure unique name (avoid overwriting)
                            var outPath = MakeUniquePath(Path.Combine(_exportRoot, fileName));

                            await using var outFs = File.Create(outPath);
                            await using var inStream = entry.Open();
                            await inStream.CopyToAsync(outFs);

                            saved++;
                        }
                    }

                    // Respond first
                    await SendJson(res, new
                    {
                        success = true,
                        exportedTo = _exportRoot,
                        filesSaved = saved
                    });

                    // Then shut down reliably: Close() breaks GetContextAsync()
                    // Small delay helps ensure the response is flushed before teardown.
                    _ = Task.Run(async () =>
                    {
                        await Task.Delay(150);
                        RequestShutdown(closeListener: true);
                    });

                    return;
                }

                // Helpers (inside class)
                static string SanitizeFileName(string name)
                {
                    // drop any path parts, keep just the leaf name
                    name = Path.GetFileName(name);

                    foreach (var c in Path.GetInvalidFileNameChars())
                        name = name.Replace(c, '_');

                    if (string.IsNullOrWhiteSpace(name))
                        name = "export.png";

                    return name;
                }

                static string MakeUniquePath(string path)
                {
                    if (!File.Exists(path)) return path;

                    var dir = Path.GetDirectoryName(path)!;
                    var baseName = Path.GetFileNameWithoutExtension(path);
                    var ext = Path.GetExtension(path);

                    for (int i = 2; ; i++)
                    {
                        var candidate = Path.Combine(dir, $"{baseName}_{i}{ext}");
                        if (!File.Exists(candidate))
                            return candidate;
                    }
                }

                if (path.StartsWith("/snip-doc-files/"))
                {
                    var rel = Uri.UnescapeDataString(path["/snip-doc-files/".Length..]);

                    // prevent escaping DOCS_ROOT
                    var abs = SafeJoin(_docsRoot, rel);
                    if (abs is null || !_allowedExtRegex.IsMatch(abs) || !File.Exists(abs))
                    {
                        res.StatusCode = 400;
                        await SendJson(res, new { error = "Invalid file path" });
                        return;
                    }

                    await SendFile(res, abs);
                    return;
                }

                res.StatusCode = 404;
                await SendJson(res, new { error = "Not found" });
            }
            catch (Exception ex)
            {
                // If we're shutting down, exceptions can happen due to close/dispose.
                if (!IsShutdownRequested())
                {
                    res.StatusCode = 500;
                    try { await SendJson(res, new { error = ex.Message }); } catch { /* ignore */ }
                }
            }
            finally
            {
                try { res.Close(); } catch { /* ignore */ }
            }
        }

        private Document? GetDocById(string id) => ListDocuments().FirstOrDefault(d => d.Id == id);

        private List<Document> ListDocuments()
        {
            var docs = new List<Document>();
            if (!Directory.Exists(_docsRoot)) return docs;

            // leaf folder rule: leaf folder with page_####.(png/jpg/...) files is a document
            foreach (var dir in Directory.GetDirectories(_docsRoot, "*", SearchOption.AllDirectories))
            {
                var subDirs = Directory.GetDirectories(dir);
                var pageFiles = Directory.GetFiles(dir)
                    .Select(Path.GetFileName)
                    .Where(n => n is not null && _pageRegex.IsMatch(n))
                    .Select(n => Path.Combine(dir, n!))
                    .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
                    .ToList();

                if (subDirs.Length == 0 && pageFiles.Count > 0)
                {
                    var rel = Path.GetRelativePath(_docsRoot, dir).Replace("\\", "/");
                    docs.Add(new Document
                    {
                        Id = rel,
                        Name = Path.GetFileName(dir),
                        RelativePath = rel,
                        AbsPath = dir,
                        Pages = pageFiles
                    });
                }
            }

            docs.Sort((a, b) => StringComparer.OrdinalIgnoreCase.Compare(a.RelativePath, b.RelativePath));
            return docs;
        }

        private static string? SafeJoin(string baseDir, string relPath)
        {
            var abs = Path.GetFullPath(Path.Combine(baseDir, relPath));
            var baseAbs = Path.GetFullPath(baseDir);
            return abs.StartsWith(baseAbs, StringComparison.OrdinalIgnoreCase) ? abs : null;
        }

        private static async Task SendJson(HttpListenerResponse res, object data)
        {
            var json = JsonSerializer.Serialize(data);
            var bytes = System.Text.Encoding.UTF8.GetBytes(json);
            res.ContentType = "application/json; charset=utf-8";
            res.ContentLength64 = bytes.Length;
            await res.OutputStream.WriteAsync(bytes);
        }

        private static async Task SendFile(HttpListenerResponse res, string path)
        {
            if (!File.Exists(path))
            {
                res.StatusCode = 404;
                return;
            }

            var ext = Path.GetExtension(path).ToLowerInvariant();
            res.ContentType = ext switch
            {
                ".png" => "image/png",
                ".jpg" or ".jpeg" => "image/jpeg",
                ".webp" => "image/webp",
                ".htm" or ".html" => "text/html; charset=utf-8",
                ".css" => "text/css; charset=utf-8",
                ".js" => "application/javascript; charset=utf-8",
                _ => "application/octet-stream"
            };


            var bytes = await File.ReadAllBytesAsync(path);
            res.ContentLength64 = bytes.Length;
            await res.OutputStream.WriteAsync(bytes);
        }

        private sealed class Document
        {
            public required string Id { get; set; }
            public required string Name { get; set; }
            public required string RelativePath { get; set; }
            public required string AbsPath { get; set; }
            public required List<string> Pages { get; set; }
        }
    }
}