param([switch]$Watch, [string]$Root = 'C:\Backup NEXO')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression.FileSystem
$utf8 = New-Object System.Text.UTF8Encoding($false)
$rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')
if ($rootPath -ne 'C:\Backup NEXO') { throw 'Pasta de backup não autorizada.' }
$config = Get-Content -LiteralPath (Join-Path $rootPath 'Automatico\config.json') -Raw | ConvertFrom-Json
if ($config.url -notmatch '^https://[a-z0-9]+\.supabase\.co$') { throw 'Servidor inválido.' }
$protectedToken = (Get-Content -LiteralPath (Join-Path $rootPath 'Automatico\device.dpapi') -Raw).Trim()
$secure = ConvertTo-SecureString -String $protectedToken
$token = (New-Object System.Net.NetworkCredential('', $secure)).Password
$mutex = New-Object System.Threading.Mutex($false, 'Local\NEXO-SAP-RS-Backup')
if (-not $mutex.WaitOne(0)) { exit 0 }
function Hash-Bytes([byte[]]$Bytes) {
 $sha = [Security.Cryptography.SHA256]::Create()
 try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
}
function Invoke-Rpc([string]$Name, [hashtable]$Params) {
 $Params.p_token = $token
 Invoke-RestMethod -Method Post -Uri ($config.url + '/rest/v1/rpc/' + $Name) -Headers @{apikey=$config.key} -ContentType 'application/json; charset=utf-8' -Body $utf8.GetBytes(($Params | ConvertTo-Json -Compress)) -TimeoutSec 180
}
function Assert-Archive([string]$Path, $Manifest, [string]$ExpectedManifest) {
 $zip = [IO.Compression.ZipFile]::OpenRead($Path)
 try {
  if ($zip.Entries.Count -ne @($Manifest.entries).Count + 1) { throw 'Quantidade de partes incorreta.' }
  foreach ($entry in @(@{file='manifest.json';sha256=$ExpectedManifest}) + @($Manifest.entries)) {
   $item = $zip.GetEntry($entry.file)
   if (-not $item) { throw 'Parte ausente.' }
   $stream = $item.Open(); $memory = New-Object IO.MemoryStream
   try { $stream.CopyTo($memory); if ((Hash-Bytes $memory.ToArray()) -ne $entry.sha256) { throw 'Checksum divergente.' } }
   finally { $stream.Dispose(); $memory.Dispose() }
  }
 } finally { $zip.Dispose() }
}
function Receive-Pending {
 # Bound each pass; more pending jobs are picked up by the next scheduled pass.
 for ($jobNumber=0; $jobNumber -lt 20; $jobNumber++) {
  $job = Invoke-Rpc 'nexo_backup_poll' @{}
  if (-not $job.pending) { return }
  if ($job.id -notmatch '^[a-f0-9-]{36}$' -or (Hash-Bytes $utf8.GetBytes($job.manifest)) -ne $job.sha256) { throw 'Manifesto inválido.' }
  $manifest = $job.manifest | ConvertFrom-Json
  if ($manifest.id -ne $job.id -or $manifest.format -ne 'nexo-sap-rs-v1') { throw 'Formato inválido.' }
  foreach ($entry in $manifest.entries) {
   if ($entry.file -notmatch '^[a-z_]+/[0-9]{6}\.json$' -or $entry.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Nome de parte inválido.' }
  }
  $stamp = ([DateTimeOffset]$manifest.captured_at).ToUniversalTime().ToString('yyyyMMdd_HHmmss')
  $target = Join-Path $rootPath ('NEXO_SAP-RS_' + $stamp + '_' + $job.id + '.zip')
  $partial = $target + '.partial'
  if (-not (Test-Path -LiteralPath $target)) {
   # Partial files belong only to this receiver/job. Never remove or overwrite a dated ZIP.
   if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial }
   $zip = [IO.Compression.ZipFile]::Open($partial, [IO.Compression.ZipArchiveMode]::Create)
   try {
    foreach ($entry in @(@{file='manifest.json';sha256=$job.sha256}) + @($manifest.entries)) {
     if ($entry.file -eq 'manifest.json') { $payload = $job.manifest }
     else { $part = Invoke-Rpc 'nexo_backup_chunk' @{p_job=$job.id;p_sha256=$entry.sha256}; $payload = $part.payload }
     $bytes = $utf8.GetBytes($payload)
     if ((Hash-Bytes $bytes) -ne $entry.sha256) { throw 'Parte corrompida durante transferência.' }
     $stream = $zip.CreateEntry($entry.file, [IO.Compression.CompressionLevel]::Optimal).Open()
     try { $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
    }
   } finally { $zip.Dispose() }
   Assert-Archive $partial $manifest $job.sha256
   [IO.File]::Move($partial,$target)
  }
  # Recheck even an existing final ZIP (e.g. network failed after rename, before ACK).
  Assert-Archive $target $manifest $job.sha256
  $zipHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
  [IO.File]::WriteAllText(($target + '.sha256'), $zipHash + '  ' + [IO.Path]::GetFileName($target), $utf8)
  $null = Invoke-Rpc 'nexo_backup_ack' @{p_job=$job.id;p_manifest_sha256=$job.sha256}
  [IO.File]::WriteAllText((Join-Path $rootPath 'Automatico\ultimo-sucesso.txt'), ([DateTimeOffset]::Now.ToString('o') + ' | ' + [IO.Path]::GetFileName($target)), $utf8)
 }
}
try {
 do {
  try { Receive-Pending }
  catch {
   Write-Warning ('Recebimento pendente: ' + $_.Exception.GetType().Name + ' | linha ' + $_.InvocationInfo.ScriptLineNumber)
   # No raw server responses, tokens, names or business payloads in local error logs.
   [IO.File]::WriteAllText((Join-Path $rootPath 'Automatico\ultima-falha.txt'), ([DateTimeOffset]::Now.ToString('o') + ' | Transferência pendente; nova tentativa automática. Verifique rede, espaço e autorização do dispositivo.'), $utf8)
   if (-not $Watch) { exit 1 }
  }
  if ($Watch) { Start-Sleep -Seconds 600 }
 } while ($Watch)
} finally { $mutex.ReleaseMutex(); $mutex.Dispose(); $token = $null }
