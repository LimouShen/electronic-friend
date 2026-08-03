#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$logPath = Join-Path $projectRoot "data\private-host-controller-install.log"
Start-Transcript -Path $logPath -Force | Out-Null
$controllerScriptPath = Join-Path $PSScriptRoot "private-host-controller.ps1"
$iconPath = Join-Path $PSScriptRoot "shitou-eye-roll.ico"
$powershellPath = Join-Path $env:WINDIR "System32\WindowsPowerShell\v1.0\powershell.exe"
$tailscalePath = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
$oldTaskName = "ElectronicFriend"
$controllerTaskName = "ElectronicFriendController"

if (-not (Test-Path -LiteralPath $controllerScriptPath)) {
  throw "Controller script not found at $controllerScriptPath"
}

if (-not (Test-Path -LiteralPath $tailscalePath)) {
  throw "Tailscale is not installed at $tailscalePath"
}

if (-not (Test-Path -LiteralPath $iconPath)) {
  throw "Controller icon not found at $iconPath"
}

# Remove the old always-on Node task and stop only the Electronic Friend server it owned.
if (Get-ScheduledTask -TaskName $oldTaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $oldTaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $oldTaskName -Confirm:$false
}

Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match "apps[\\/]api[\\/]server\.mjs" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# Restore the power values that were active before the always-on experiment.
powercfg /change standby-timeout-ac 15
powercfg /change hibernate-timeout-ac 180

# Tailscale is now started and stopped by the desktop controller instead of Windows startup.
& $tailscalePath down
Stop-Service -Name Tailscale -Force -ErrorAction SilentlyContinue
Set-Service -Name Tailscale -StartupType Manual
Get-Process -Name "tailscale-ipn" -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$controllerArguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$controllerScriptPath`""
$action = New-ScheduledTaskAction `
  -Execute $powershellPath `
  -Argument $controllerArguments `
  -WorkingDirectory $projectRoot
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName $controllerTaskName `
  -Action $action `
  -Principal $principal `
  -Settings $settings `
  -Description "Opens the Electronic Friend private connection controller on demand." `
  -Force | Out-Null

# The installer runs elevated, so explicitly let the interactive owner query and run
# this one task from the normal desktop shortcut without another UAC prompt.
$taskService = New-Object -ComObject "Schedule.Service"
$taskService.Connect()
$registeredTask = $taskService.GetFolder("\").GetTask("\$controllerTaskName")
$currentUserSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskSecurityDescriptor = "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;$currentUserSid)"
$registeredTask.SetSecurityDescriptor($taskSecurityDescriptor, 0)

$desktop = Join-Path $env:USERPROFILE "Desktop"
$shortcutPath = Join-Path $desktop "石头开关.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR "System32\schtasks.exe"
$shortcut.Arguments = "/Run /TN `"$controllerTaskName`""
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = "Start or stop the private Electronic Friend connection"
$shortcut.Save()

Write-Host "Electronic Friend desktop controller installed." -ForegroundColor Green
Write-Host "Shortcut: $shortcutPath"
Write-Host "The old always-on task was removed and normal sleep settings were restored."
Stop-Transcript | Out-Null
