$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir "..\.."))
$projectPath = Join-Path $scriptDir "CreateSimpleAssignment.csproj"
$publishDir = Join-Path $scriptDir "bin\Release\net10.0-windows\win-x64\publish"
$sourceExe = Join-Path $publishDir "CreateSimpleAssignment.exe"
$nativeFiles = @(
    "libSkiaSharp.dll",
    "pdfium.dll"
)
$targetExe = Join-Path $repoRoot "CreateSimpleAssignment.exe"

Write-Host "Publishing CreateSimpleAssignment..."
dotnet publish $projectPath -c Release

if (-not (Test-Path -LiteralPath $sourceExe)) {
    throw "Publish completed but '$sourceExe' was not found."
}

Copy-Item -LiteralPath $sourceExe -Destination $targetExe -Force

foreach ($fileName in $nativeFiles) {
    $sourcePath = Join-Path $publishDir $fileName
    if (Test-Path -LiteralPath $sourcePath) {
        $targetPath = Join-Path $repoRoot $fileName
        Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
    }
}

Write-Host "Replaced root executable artifacts:"
Write-Host "  $targetExe"
foreach ($fileName in $nativeFiles) {
    $targetPath = Join-Path $repoRoot $fileName
    if (Test-Path -LiteralPath $targetPath) {
        Write-Host "  $targetPath"
    }
}
