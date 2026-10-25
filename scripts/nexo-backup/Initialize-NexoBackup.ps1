param([Parameter(Mandatory=$true)][string]$Url, [Parameter(Mandatory=$true)][string]$PublishableKey)
$ErrorActionPreference='Stop'
$folder='C:\Backup NEXO\Automatico'
$null=New-Item -ItemType Directory -Path $folder -Force
$credential=Join-Path $folder 'device.dpapi'
if (Test-Path -LiteralPath $credential) { throw 'Dispositivo já inicializado. Não sobrescrever a credencial existente.' }
$random=New-Object byte[] 32
$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($random) } finally { $rng.Dispose() }
$token=([BitConverter]::ToString($random)).Replace('-','').ToLowerInvariant()
$token | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $credential
@{url=$Url;key=$PublishableKey} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $folder 'config.json') -Encoding UTF8
$sha=[Security.Cryptography.SHA256]::Create()
try { $hash=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($token)))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose(); $token=$null }
# Only the non-secret hash is used for server registration. The device token never leaves DPAPI storage except authenticated RPC calls.
Write-Output $hash
