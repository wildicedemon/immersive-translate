param(
    [string]$BackgroundPath = "dist/firefox/background.js"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -Path $BackgroundPath)) {
    throw "Background file not found: $BackgroundPath"
}

$content = Get-Content -Path $BackgroundPath -Raw

function Assert-Contains {
    param(
        [string]$Pattern,
        [string]$Message
    )

    if ($content -notmatch $Pattern) {
        throw "FAILED: $Message`nPattern not found: $Pattern"
    }
}

function Assert-NotContains {
    param(
        [string]$Pattern,
        [string]$Message
    )

    if ($content -match $Pattern) {
        throw "FAILED: $Message`nForbidden pattern found: $Pattern"
    }
}

# Required background URL invariants for auth-related flows
Assert-Contains 'OPTIONS_URL:"\{\{DASH_BASE_URL\}\}"' 'Options URL constant must point to dashboard base URL'
Assert-Contains 'USER_LOGIN_URL_FROM_ERROR:"\{\{OFFICIAL_URL\}\}/accounts/login\?from=plugin&utm_source=extension&utm_medium=extension&utm_campaign=error_modal"' 'Error login URL constant must point to login endpoint'
Assert-Contains 'GO_AUTH_PRICING_FOR_MANGA_GUIDE:"\{\{OFFICIAL_URL\}\}/auth/pricing/\?utm_source=extension&utm_medium=extension&utm_campaign=manga_guide"' 'Manga guide pricing URL constant must exist and be auth/pricing'

# Forbidden regressions for auth URL mappings
Assert-NotContains 'USER_LOGIN_URL_FROM_ERROR:"\{\{OFFICIAL_URL\}\}/pricing/' 'Error login URL must not point to pricing'
Assert-NotContains 'GO_AUTH_PRICING_FOR_MANGA_GUIDE:"\{\{OFFICIAL_URL\}\}/accounts/login' 'Manga guide pricing URL must not point to login'

Write-Host "AUTH-001 background guard passed for $BackgroundPath"
