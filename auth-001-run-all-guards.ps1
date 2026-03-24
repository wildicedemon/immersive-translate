$ErrorActionPreference = "Stop"

./auth-001-guard.ps1
./auth-001-background-guard.ps1

Write-Host "All AUTH-001 guards passed"
