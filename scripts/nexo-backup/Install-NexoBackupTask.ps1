$ErrorActionPreference='Stop'
$script='C:\Backup NEXO\Automatico\Receive-NexoBackup.ps1'
if (-not (Test-Path -LiteralPath $script)) { throw 'Receptor não instalado.' }
$executable=Join-Path $PSHOME 'pwsh.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Instale usando o PowerShell 7 autorizado nesta máquina.' }
$arguments='-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $script + '"'
$action=New-ScheduledTaskAction -Execute $executable -Argument $arguments
$trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 10)
$logon=New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$null=Register-ScheduledTask -TaskName 'NEXO - Backup SAP RS' -Action $action -Trigger @($trigger,$logon) -Settings $settings -Principal $principal
Write-Output 'Tarefa instalada: a cada 10 minutos e ao entrar no Windows, sem senha e sem privilégios elevados.'
