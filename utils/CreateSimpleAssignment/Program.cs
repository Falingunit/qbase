using CreateSimpleAssignment;
using PDFtoImage;
using SkiaSharp;
using Spectre.Console;
using System.Diagnostics;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using TextCopy;

const string PromptColor = "aqua";
const string TitleStyle = "bold fuchsia";
const string DefaultApiBase = "https://qbase.103.125.154.215.nip.io";
var jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);

// Heading ---
AnsiConsole.Write(new Rule("[yellow]QBase simple assignment maker[/]").DoubleBorder());
AnsiConsole.WriteLine();

//Update git
AnsiConsole.Write(new Rule($"[{TitleStyle}]Updating repository[/]").LeftJustified());

GitUpdater.PullWithEphemeralLogs();
AnsiConsole.WriteLine();

// API details
AnsiConsole.Write(new Rule($"[{TitleStyle}]Connect to backend[/]").LeftJustified());

string apiBase = AnsiConsole.Prompt(
    new TextPrompt<string>($"[{PromptColor}]API base URL:[/]")
        .DefaultValue(DefaultApiBase)
);
string apiUsername = AnsiConsole.Ask<string>($"[{PromptColor}]API username:[/] ");
string apiPassword = AnsiConsole.Prompt(
    new TextPrompt<string>($"[{PromptColor}]API password:[/]").Secret()
);

var apiClient = new HttpClient
{
    BaseAddress = new Uri(NormalizeApiBase(apiBase))
};
string authToken = "";

AnsiConsole.Status()
    .Spinner(Spinner.Known.Dots)
    .Start("Signing into API...", AuthenticateApi);

AnsiConsole.MarkupLine($"[lime]Signed into backend as [bold]{apiUsername}[/].[/]");
AnsiConsole.WriteLine();

// Assignment details
AnsiConsole.Write(new Rule($"[{TitleStyle}]Enter assignment details[/]").LeftJustified());

string assignmentTitle = AnsiConsole.Ask<string>($"[{PromptColor}]Title:[/] ");

Subjects subjectSelection = AnsiConsole.Prompt(
    new SelectionPrompt<Subjects>()
        .Title($"[{PromptColor}]Subject:[/]")
        .AddChoices(Enum.GetValues<Subjects>())
);

string subject = subjectSelection == Subjects.Other
    ? AnsiConsole.Ask<string>($"[{PromptColor}]Subject ([italic]Other[/]):[/]")
    : subjectSelection.ToString();

if (subjectSelection != Subjects.Other)
    AnsiConsole.MarkupLine($"[{PromptColor}]Subject:[/] {subject}");

string chapter = AnsiConsole.Ask<string>($"[{PromptColor}]Chapter:[/] ");
string facultyName = AnsiConsole.Ask<string>($"[{PromptColor}]Faculty name:[/] ");

uint? assignmentId = AnsiConsole.Prompt(
    new TextPrompt<uint?>($"[{PromptColor}]Enter assignment ID [italic grey](leave blank to autopick [[RECOMMENDED]])[/]:[/]")
        .AllowEmpty()
        .DefaultValue(null)
        .HideDefaultValue()
);

AnsiConsole.Status()
    .Spinner(Spinner.Known.Dots)
    .Start("Creating assignment...", UpdateAssignmentData);

AnsiConsole.MarkupLine($"[lime]Successfully added assignment details with assignment ID [bold italic]{assignmentId}[/]![/]");
AnsiConsole.WriteLine();

// PDF selection
AnsiConsole.Write(new Rule($"[{TitleStyle}]Choose assignment PDF[/]").LeftJustified());
AnsiConsole.MarkupLine($"[{PromptColor}]Select the assignment PDF in the following dialog...[/]");

string pdfImportPath = PdfPicker();
string processedImagesDestination = "";
AnsiConsole.MarkupLine($"[{PromptColor}]Chosen assignment PDF: [/]{Path.GetFileName(pdfImportPath)}");
AnsiConsole.Status()
    .Spinner(Spinner.Known.Dots)
    .Start("Processing PDF...", ProcessPdf);

AnsiConsole.MarkupLine("[lime]Successfully processed PDF![/]");
AnsiConsole.WriteLine();

// AI Answer key step
AnsiConsole.Write(new Rule($"[{TitleStyle}]Get answers and question type using AI[/]").LeftJustified());
AnsiConsole.MarkupLine(
$"[{PromptColor}]Follow these steps:\n" +
$"1. Open ChatGPT [italic](make sure you are logged in)[/].\n" +
$"2. Paste the prompt that has been copied into your [italic]clipboard[/].\n" +
$"3. The folder containing the images will open shortly.\n" +
$"4. Select all the images [italic bold](make sure to include the answer key, solution pages are not required)[/].\n" +
$"5. Upload the selected images in the chat.\n" +
$"6. Send the message.[/]"
);
string s = "```OCR → Minimal JSON (Simple Mode)\n\nInput: raw OCR questions + official answer key.\n\nTask:\n1) Detect qType: SMCQ / MMCQ / Numerical / Passage.\n2) Detect shared context (anything reused across multiple questions) → create a Passage object \"P#\".\n   - Store the shared content as image \"p#.png\".\n   - Questions using it must have passageId = \"P#\".\n3) If a question is \"match the following / match list / column match\":\n   - Convert it to SMCQ.\n   - Create 4 options (A–D) representing the valid match combinations (use OCR content).\n4) Assign answers strictly using the answer key. Do NOT solve.\n\nOutput rules:\n- Return ONLY a JSON array inside a single ```json``` codeblock.\n- The JSON MUST be minified: ONE LINE ONLY (no indentation, no line breaks, no extra spaces/newlines).\n- image naming:\n  - question → \"qNo.png\" (e.g., \"1.png\", \"2.png\")\n  - passage → \"p#.png\"\n- qOptions = [] unless it is a match-list question (then must be 4 options).\n- If an answer cannot be mapped confidently, OMIT that item from the JSON and write an Issues list AFTER the codeblock (not inside it).\n\nJSON shape (keys must match exactly):\n{ \"qType\": \"SMCQ|MMCQ|Numerical|Passage\", \"passageId\": null|\"P#\", \"image\": \"qNo.png|p#.png\", \"qOptions\": [], \"qAnswer\": \"A\"|[\"A\",\"C\"]|12.5|[] }\n\nExample (format only; your real output must follow this minified style):\n[{\"qType\":\"Passage\",\"passageId\":\"P1\",\"image\":\"p1.png\",\"qOptions\":[],\"qAnswer\":[]},{\"qType\":\"SMCQ\",\"passageId\":null,\"image\":\"1.png\",\"qOptions\":[],\"qAnswer\":\"C\"}]```";
ClipboardService.SetText(s);
Process.Start(new ProcessStartInfo
{
    FileName = "explorer.exe",
    Arguments = processedImagesDestination,
    UseShellExecute = true
});
AnsiConsole.MarkupLine($"[{PromptColor}]Press [italic]Enter[/] after pressing send. [bold italic]DO NOT wait for ChatGPT to finish replying[/]...[/]"); Console.ReadLine();

// Screenshot
AnsiConsole.Write(new Rule($"[{TitleStyle}]Cropping questions[/]").LeftJustified());

var server = new SnipDocServer(AppContext.BaseDirectory + "/utils", AppContext.BaseDirectory + $"/frontend/data/question_data/{assignmentId}");
AnsiConsole.MarkupLine($"[{PromptColor}]Open [link=http://localhost:3030]this[/] [italic][[Ctrl + Click]][/] and crop the questions, and click [italic]Export[/]. After it finishes exporting come back here.[/]");

await AnsiConsole.Status()
    .Spinner(Spinner.Known.Dots)
    .StartAsync("Waiting for export...", async ctx =>
    {
        await server.StartAsync();
    });

AnsiConsole.MarkupLine($"[{PromptColor}][lime]Questions exported successfuly! You can now close the browser tab.[/][/]");
AnsiConsole.WriteLine();

// AI Answer key step
AnsiConsole.Write(new Rule($"[{TitleStyle}]Get answers and question type using AI[/]").LeftJustified());
AnsiConsole.Markup($"[{PromptColor}]Wait till ChatGPT finishes replying. [italic]Make sure to resolve all issues[/]. press [italic]Enter[/] to continue...[/]"); Console.ReadLine();
string aiOutput = AnsiConsole.Ask<string>($"[{PromptColor}]Paste the output given by ChatGPT inside codeblocks here and press [italic]Enter[/][/]:");

string assignmentJson = SimpleModeConverter.ConvertSimpleJsonToOldJson(aiOutput);
AnsiConsole.Status()
    .Spinner(Spinner.Known.Dots)
    .Start("Writing contents into [underline]assignment.json[/]...", ctx =>
    {
        File.WriteAllText($"./frontend/data/question_data/{assignmentId}/assignment.json", assignmentJson);
    });

AnsiConsole.Status()
    .Spinner(Spinner.Known.Dots)
    .Start("Syncing assignment with backend...", SyncAssignmentToApi);

AnsiConsole.MarkupLine("[lime]Successfully added assignment data![/]");
AnsiConsole.Write(new Rule($"[{TitleStyle}]Updating repository[/]").LeftJustified());

GitUpdater.CommitAndPush($"Added assignment {assignmentId}: {assignmentTitle}");
AnsiConsole.WriteLine();

AnsiConsole.MarkupLine($"[{PromptColor}][lime]Successfully added assignments! You can now close this window and check [link=https://github.com/Falingunit/qbase]here[/][/][/]");

Thread.Sleep(10000000);

void UpdateAssignmentData(StatusContext ctx)
{
    if (assignmentId is null)
    {
        ctx.Status("Requesting next assignment ID from backend...");
        assignmentId = FetchNextAssignmentId();
    }

    ctx.Status("Creating assignment directory...");
    Directory.CreateDirectory($"./frontend/data/question_data/{assignmentId}");

    ctx.Status("[lime]Done![/]");
}

void ProcessPdf(StatusContext ctx)
{
    string pdfMovedPath = $"./utils/PDF Screenshots/{subject}/{chapter}/{Path.GetFileName(pdfImportPath)}";
    string? pdfMovedDirectory = Path.GetDirectoryName(pdfMovedPath);

    if (string.IsNullOrWhiteSpace(pdfMovedDirectory))
        throw new InvalidOperationException("Could not determine destination directory.");

    ctx.Status($"Creating directory [underline]'{pdfMovedDirectory}'[/]...");
    Directory.CreateDirectory(pdfMovedDirectory);

    ctx.Status($"Copying assignment PDF from [underline]'{pdfImportPath}'[/] to [underline]'{pdfMovedPath}'[/]...");
    File.Copy(pdfImportPath, pdfMovedPath, overwrite: true);

    ctx.Status("Converting PDF to images...");

    var pdfFileName = Path.GetFileNameWithoutExtension(pdfMovedPath);
    processedImagesDestination = Path.Combine(pdfMovedDirectory, $"{pdfFileName}");

    Directory.CreateDirectory(processedImagesDestination);

    var options = new RenderOptions { Dpi = 350 };

    using var pdfStream = File.OpenRead(pdfMovedPath);

    int page = 0;

    foreach (SKBitmap bmp in Conversion.ToImages(pdfStream, leaveOpen: true, password: null, options: options))
    {
        page++;

        var pageImageOutputPath = Path.Combine(processedImagesDestination, $"page_{page:0000}.png");

        ctx.Status($"Converting PDF to images: [italic]Writing page {page}...[/]");
        using (bmp)
        using (var fs = File.Open(pageImageOutputPath, FileMode.Create, FileAccess.Write))
        {
            bmp.Encode(fs, SKEncodedImageFormat.Png, 100);
        }
    }
    ctx.Status("[lime]Done![/]");
}

static string PdfPicker()
{
    string? selected = null;

    var dialogThread = new Thread(() =>
    {
        using var dlg = new OpenFileDialog
        {
            Title = "Select assignment PDF",
            Filter = "PDF Files (*.pdf)|*.pdf|All Files (*.*)|*.*",
            CheckFileExists = true
        };

        selected = dlg.ShowDialog() == DialogResult.OK ? dlg.FileName : "";
    });

    dialogThread.SetApartmentState(ApartmentState.STA);
    dialogThread.Start();

    AnsiConsole.Status()
        .Spinner(Spinner.Known.Dots)
        .Start("Waiting for selection to be made...", _ =>
        {
            while (dialogThread.IsAlive)
                Thread.Sleep(50);
        });

    dialogThread.Join();
    return selected ?? "";
}

void AuthenticateApi(StatusContext ctx)
{
    ctx.Status("Logging in...");
    var loginResponse = apiClient.PostAsJsonAsync(
        "/login",
        new LoginRequest(apiUsername, apiPassword),
        jsonOptions
    ).GetAwaiter().GetResult();

    if (!loginResponse.IsSuccessStatusCode)
    {
        string body = loginResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult();
        throw new InvalidOperationException($"Login failed ({(int)loginResponse.StatusCode}): {body}");
    }

    var loginPayload = loginResponse.Content.ReadFromJsonAsync<LoginResponse>(jsonOptions)
        .GetAwaiter().GetResult()
        ?? throw new InvalidOperationException("Login response was empty.");

    if (string.IsNullOrWhiteSpace(loginPayload.Token))
        throw new InvalidOperationException("Login response did not include a token.");

    authToken = loginPayload.Token;
    apiClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", authToken);

    ctx.Status("Verifying session...");
    var meResponse = apiClient.GetAsync("/me").GetAwaiter().GetResult();
    if (!meResponse.IsSuccessStatusCode)
    {
        string body = meResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult();
        throw new InvalidOperationException($"Session verification failed ({(int)meResponse.StatusCode}): {body}");
    }

    var mePayload = meResponse.Content.ReadFromJsonAsync<MeResponse>(jsonOptions)
        .GetAwaiter().GetResult();
    if (mePayload is null || string.IsNullOrWhiteSpace(mePayload.Username))
        throw new InvalidOperationException("Session verification returned no user.");
}

uint FetchNextAssignmentId()
{
    var response = apiClient.GetAsync("/api/admin/assignments/next-id").GetAwaiter().GetResult();
    if (!response.IsSuccessStatusCode)
    {
        string body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
        throw new InvalidOperationException($"Failed to get next assignment ID ({(int)response.StatusCode}): {body}");
    }

    var payload = response.Content.ReadFromJsonAsync<NextAssignmentIdResponse>(jsonOptions)
        .GetAwaiter().GetResult()
        ?? throw new InvalidOperationException("Next assignment ID response was empty.");

    if (payload.AssignmentId <= 0)
        throw new InvalidOperationException("Backend returned an invalid assignment ID.");

    return checked((uint)payload.AssignmentId);
}

void SyncAssignmentToApi(StatusContext ctx)
{
    ctx.Status("Preparing API payload...");
    using JsonDocument assignmentDocument = JsonDocument.Parse(assignmentJson);
    var request = new AssignmentUpsertRequest
    {
        AssignmentId = checked((int)assignmentId!.Value),
        Title = assignmentTitle,
        Subject = subject,
        Faculty = facultyName,
        Chapter = chapter,
        SourceRelPath = $"frontend/data/question_data/{assignmentId}/assignment.json",
        Assignment = assignmentDocument.RootElement.Clone()
    };

    ctx.Status("Uploading assignment metadata and payload...");
    var response = apiClient.PostAsJsonAsync("/api/admin/assignments", request, jsonOptions)
        .GetAwaiter().GetResult();

    if (!response.IsSuccessStatusCode)
    {
        string body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
        throw new InvalidOperationException($"Assignment sync failed ({(int)response.StatusCode}): {body}");
    }
}

static string NormalizeApiBase(string input)
{
    string trimmed = (input ?? "").Trim();
    if (string.IsNullOrWhiteSpace(trimmed))
        return DefaultApiBase;

    return trimmed.TrimEnd('/') + "/";
}

public enum Subjects
{
    Mathematics,
    Physics,
    Chemistry,
    Other
}

public readonly struct Assignment
{
    [JsonPropertyName("subject")]
    public string Subject { get; init; }

    [JsonPropertyName("faculty")]
    public string Faculty { get; init; }

    [JsonPropertyName("chapter")]
    public string Chapter { get; init; }

    [JsonPropertyName("title")]
    public string Title { get; init; }

    [JsonPropertyName("aID")]
    public int ID { get; init; }
}

public sealed record LoginRequest(
    [property: JsonPropertyName("username")] string Username,
    [property: JsonPropertyName("password")] string Password
);

public sealed class LoginResponse
{
    [JsonPropertyName("token")]
    public string Token { get; init; } = "";
}

public sealed class MeResponse
{
    [JsonPropertyName("username")]
    public string Username { get; init; } = "";
}

public sealed class NextAssignmentIdResponse
{
    [JsonPropertyName("assignmentId")]
    public int AssignmentId { get; init; }
}

public sealed class AssignmentUpsertRequest
{
    [JsonPropertyName("assignmentId")]
    public int AssignmentId { get; init; }

    [JsonPropertyName("title")]
    public string Title { get; init; } = "";

    [JsonPropertyName("subject")]
    public string Subject { get; init; } = "";

    [JsonPropertyName("faculty")]
    public string Faculty { get; init; } = "";

    [JsonPropertyName("chapter")]
    public string Chapter { get; init; } = "";

    [JsonPropertyName("sourceRelPath")]
    public string SourceRelPath { get; init; } = "";

    [JsonPropertyName("assignment")]
    public JsonElement Assignment { get; init; }
}
