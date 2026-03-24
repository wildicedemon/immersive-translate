param(
    [string]$PopupPath = "dist/firefox/popup.js"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -Path $PopupPath)) {
    throw "Popup file not found: $PopupPath"
}

$content = Get-Content -Path $PopupPath -Raw

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

# Required AUTH-001 behavior
Assert-Contains 'if\(!i\.user&&d\)\{Ze\(U\.OPTIONS_URL\);return\}' 'Manga guide non-pro free-credit branch must route to options'
Assert-Contains 'id:"free_image_login_required"[\s\S]*?onClick:\(\)=>\{Ze\(U\.OPTIONS_URL\),t\(\)\},children:n\("imageQuota\.loginNow"\)' 'Free image login-required modal primary action must route to options'
Assert-Contains 'login:\{onBefore:\(\)=>ct\(e,"error_modal_login"\),renderBody:u=>\{let l=t\|\|U\.OPTIONS_URL;' 'Error modal login action fallback must be options'

# Forbidden regressions for targeted branches
Assert-NotContains 'if\(!i\.user&&d\)\{Ze\(U\.USER_LOGIN_URL\);return\}' 'Manga guide branch must not route to login URL'
Assert-NotContains 'id:"free_image_login_required"[\s\S]*?onClick:\(\)=>\{Ze\(U\.USER_LOGIN_URL(?:_FROM_ERROR)?\),t\(\)\},children:n\("imageQuota\.loginNow"\)' 'Free image login-required modal must not route to login URL'
Assert-NotContains 'login:\{onBefore:\(\)=>ct\(e,"error_modal_login"\),renderBody:u=>\{let l=t\|\|U\.PRICING_URL\+"\?utm_campaign=service_error' 'Error modal login action must not fall back to pricing service_error URL'

Write-Host "AUTH-001 guard passed for $PopupPath"
