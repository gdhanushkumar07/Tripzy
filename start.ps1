# Tripzy: Intelligence engine (:8000, loopback only) + platform (API :3001, web :5173).
$ROOT = $PSScriptRoot

if (Test-Path "$ROOT\api-keys.env") {
    Get-Content "$ROOT\api-keys.env" | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $parts = $line.Split("=", 2)
            $key = $parts[0].Trim()
            $val = $parts[1].Trim()
            if ($key -match '^[A-Z_][A-Z0-9_]*$' -and $val) {
                [Environment]::SetEnvironmentVariable($key, $val, "Process")
            }
        }
    }
}

if (Test-Path "$ROOT\platform\server\.env") {
    Get-Content "$ROOT\platform\server\.env" | ForEach-Object {
        $line = $_.Trim()
        if ($line.StartsWith("TRIPZY_ENGINE_KEY=")) {
            $val = $line.Substring("TRIPZY_ENGINE_KEY=".Length)
            [Environment]::SetEnvironmentVariable("TRIPZY_ENGINE_KEY", $val, "Process")
        }
    }
}

Write-Host "Starting Tripzy Intelligence engine on http://127.0.0.1:8000..." -ForegroundColor Cyan
$backendProc = Start-Process -FilePath "$ROOT\backend\.venv\Scripts\python.exe" -ArgumentList "-m", "uvicorn", "app.main:app", "--app-dir", "$ROOT\backend", "--host", "127.0.0.1", "--port", "8000" -PassThru -NoNewWindow

Write-Host "Starting Tripzy Platform..." -ForegroundColor Cyan
Set-Location "$ROOT\platform"
try {
    npm run dev
} finally {
    if ($backendProc -and -not $backendProc.HasExited) {
        Stop-Process -Id $backendProc.Id -Force
    }
}
