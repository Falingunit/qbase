using CreateSimpleAssignment;
using PDFtoImage;
using SkiaSharp;
using Spectre.Console;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using TextCopy;

const string PromptColor = "aqua";
const string TitleStyle = "bold fuchsia";

// Heading ---
AnsiConsole.Write(new Rule("[yellow]QBase simple assignment maker[/]").DoubleBorder());
AnsiConsole.WriteLine();

//Update git
AnsiConsole.Write(new Rule($"[{TitleStyle}]Updating repository[/]").LeftJustified());

GitUpdater.PullWithEphemeralLogs();
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

AnsiConsole.MarkupLine("[lime]Successfully added assignment data![/]");
AnsiConsole.Write(new Rule($"[{TitleStyle}]Updating repository[/]").LeftJustified());

GitUpdater.CommitAndPush($"Added assignment {assignmentId}: {assignmentTitle}");
AnsiConsole.WriteLine();

AnsiConsole.MarkupLine($"[{PromptColor}][lime]Successfully added assignments! You can now close this window and check [link=https://github.com/Falingunit/qbase]here[/][/][/]");

Thread.Sleep(10000000);

void UpdateAssignmentData(StatusContext ctx)
{
    const string assignmentListPath = "./frontend/data/assignment_list.json";

    ctx.Status("Reading [underline]assignment_list.json[/]...");

    string assignmentsJson = File.ReadAllText(assignmentListPath);
    var assignments = JsonSerializer.Deserialize<List<Assignment>>(assignmentsJson) ?? new();

    if (assignmentId is null)
    {
        int highestId = 0;
        foreach (var a in assignments)
            highestId = Math.Max(highestId, a.ID);

        // NOTE: original code set to highest ID (not highest+1). Kept same behavior.
        assignmentId = (uint)highestId + 1;
    }

    assignments.Add(new Assignment
    {
        Subject = subject,
        Faculty = facultyName,
        Chapter = chapter,
        Title = assignmentTitle,
        ID = (int)assignmentId.Value
    });

    ctx.Status("Writing [underline]assignment_list.json[/]...");
    File.WriteAllText(
        assignmentListPath,
        JsonSerializer.Serialize(assignments, new JsonSerializerOptions { WriteIndented = true })
    );

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