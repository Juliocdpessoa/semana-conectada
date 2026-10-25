$ErrorActionPreference='Stop'
$startup=[Environment]::GetFolderPath('Startup')
$path=Join-Path $startup 'NEXO - Backup SAP RS.lnk'
$engine=Join-Path $PSHOME 'pwsh.exe'
if (-not (Test-Path -LiteralPath $engine)) { throw 'Instale usando o PowerShell 7 autorizado nesta máquina.' }
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut($path)
$shortcut.TargetPath=$engine
$shortcut.Arguments='-NoProfile -NonInteractive -WindowStyle Hidden -File "C:\Backup NEXO\Automatico\Receive-NexoBackup.ps1" -Watch'
$shortcut.WorkingDirectory='C:\Backup NEXO\Automatico'
$shortcut.WindowStyle=7
$shortcut.Description='Recebe backups SAP + RS a cada 10 minutos enquanto esta conta está conectada.'
$shortcut.Save()
Write-Output 'Inicialização automática instalada para esta conta Windows.'
