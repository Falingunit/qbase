using Spectre.Console;
using System.Diagnostics;
using System.Text;

namespace CreateSimpleAssignment
{
    public static class GitUpdater
    {
        public static int PullWithEphemeralLogs()
        {
            StringBuilder log = new StringBuilder();
            var exitCode = -1;

            // Live region that keeps getting re-rendered
            AnsiConsole.Live(new Spectre.Console.Panel("Starting...").Border(BoxBorder.Rounded).Header("git pull"))
                .AutoClear(false)
                .Start(ctx =>
                {
                    ProcessStartInfo psi = new ProcessStartInfo
                    {
                        FileName = "git",
                        Arguments = "pull",
                        WorkingDirectory = AppContext.BaseDirectory,
                        UseShellExecute = false,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        CreateNoWindow = true
                    };

                    using Process p = new Process { StartInfo = psi, EnableRaisingEvents = true };

                    void Append(string? line, bool isErr)
                    {
                        if (string.IsNullOrWhiteSpace(line)) return;

                        // keep only last N lines so UI stays fast
                        log.AppendLine(line);

                        var text = Markup.Escape(log.ToString());
                        var panel = new Spectre.Console.Panel(new Markup(text))
                            .Border(BoxBorder.Rounded)
                            .Header("git pull");

                        ctx.UpdateTarget(panel);
                    }

                    p.OutputDataReceived += (_, e) => Append(e.Data, isErr: false);
                    p.ErrorDataReceived += (_, e) => Append(e.Data, isErr: true);

                    p.Start();
                    p.BeginOutputReadLine();
                    p.BeginErrorReadLine();
                    p.WaitForExit();

                    exitCode = p.ExitCode;
                });

            if (exitCode == 0)
                AnsiConsole.MarkupLine("[green]Successfully updated from source[/]");
            else
                AnsiConsole.MarkupLine("[red]Update failed. \n[bold]You should exit this program and manually fix the conflicts/errors before adding an assignment.[/][/] (exit code " + exitCode + ")");

            return exitCode;
        }
        public static int CommitAndPush(string message = "Update")
        {
            StringBuilder log = new StringBuilder();
            var exitCode = -1;

            AnsiConsole.Live(new Spectre.Console.Panel("Starting...").Border(BoxBorder.Rounded).Header("git commit & push"))
                .AutoClear(false)
                .Start(ctx =>
                {
                    void RunGit(string args)
                    {
                        ProcessStartInfo psi = new ProcessStartInfo
                        {
                            FileName = "git",
                            Arguments = args,
                            WorkingDirectory = AppContext.BaseDirectory,
                            UseShellExecute = false,
                            RedirectStandardOutput = true,
                            RedirectStandardError = true,
                            CreateNoWindow = true
                        };

                        using Process p = new Process { StartInfo = psi };

                        p.OutputDataReceived += (_, e) =>
                        {
                            if (string.IsNullOrWhiteSpace(e.Data)) return;
                            log.AppendLine(e.Data);
                            UpdatePanel(ctx, log);
                        };

                        p.ErrorDataReceived += (_, e) =>
                        {
                            if (string.IsNullOrWhiteSpace(e.Data)) return;
                            log.AppendLine(e.Data);
                            UpdatePanel(ctx, log);
                        };

                        p.Start();
                        p.BeginOutputReadLine();
                        p.BeginErrorReadLine();
                        p.WaitForExit();

                        exitCode = p.ExitCode;
                    }

                    RunGit("add .");
                    if (exitCode != 0) return;

                    RunGit($"commit -m \"{message}\"");
                    if (exitCode != 0) return;

                    RunGit("push");
                });

            if (exitCode == 0)
                AnsiConsole.MarkupLine("[green]Successfully committed and pushed to source[/]");
            else
                AnsiConsole.MarkupLine("[red]Commit or push failed. \n [bold]You should manually commit and push the changes in order to take effect.[/][/]");

            return exitCode;
        }

        static void UpdatePanel(LiveDisplayContext ctx, StringBuilder log)
        {
            var text = Markup.Escape(log.ToString());

            var panel = new Spectre.Console.Panel(new Markup(text))
                .Border(BoxBorder.Rounded)
                .Header("git commit & push");

            ctx.UpdateTarget(panel);
        }
    }
}
