#Requires -Version 5.1

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$nodePath = Join-Path $env:ProgramFiles "nodejs\node.exe"
$tailscalePath = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
$serviceControlPath = Join-Path $env:WINDIR "System32\sc.exe"
$iconPath = Join-Path $PSScriptRoot "shitou-eye-roll.ico"
$logPath = Join-Path $projectRoot "data\private-host-controller.log"
$keepAwakeFlag = [Convert]::ToUInt32("80000001", 16)
$releaseAwakeFlag = [Convert]::ToUInt32("80000000", 16)

$script:nodeProcess = $null
$script:allowClose = $false
$script:cleanupStarted = $false

function Write-ControllerLog {
  param([string]$Message)

  try {
    $directory = Split-Path -Parent $logPath
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    [System.IO.File]::AppendAllText(
      $logPath,
      "$(Get-Date -Format s) $Message$([Environment]::NewLine)"
    )
  } catch {
    # Diagnostics must never prevent start or stop.
  }
}

trap {
  Write-ControllerLog "Unhandled controller error:`n$($_ | Out-String)"
  exit 1
}

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.ServiceProcess
Add-Type -AssemblyName System.Windows.Forms

if (-not ("ElectronicFriendPowerRequest" -as [type])) {
  Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;

public static class ElectronicFriendPowerRequest
{
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint flags);
}
"@
}

function Invoke-HiddenProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string]$Arguments,
    [Parameter(Mandatory = $true)][int]$TimeoutMs
  )

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = $Arguments
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden

  $process = [System.Diagnostics.Process]::Start($startInfo)
  if ($null -eq $process) {
    throw "无法启动 $([System.IO.Path]::GetFileName($FilePath))。"
  }

  try {
    if (-not $process.WaitForExit($TimeoutMs)) {
      $process.Kill()
      throw "$([System.IO.Path]::GetFileName($FilePath)) 响应超时。"
    }

    if ($process.ExitCode -ne 0) {
      throw "$([System.IO.Path]::GetFileName($FilePath)) 返回错误 $($process.ExitCode)。"
    }
  } finally {
    $process.Dispose()
  }
}

function Test-LocalHealth {
  try {
    $request = [System.Net.HttpWebRequest]::CreateHttp("http://127.0.0.1:3001/api/health")
    $request.Timeout = 1000
    $response = [System.Net.HttpWebResponse]$request.GetResponse()
    try {
      return $response.StatusCode -eq [System.Net.HttpStatusCode]::OK
    } finally {
      $response.Dispose()
    }
  } catch {
    return $false
  }
}

function Start-PrivateHost {
  Write-ControllerLog "Starting private host controller (PowerShell host)."

  if (-not (Test-Path -LiteralPath $nodePath)) {
    throw "没有找到 Node.js。"
  }

  if (-not (Test-Path -LiteralPath $tailscalePath)) {
    throw "没有找到 Tailscale。"
  }

  Invoke-HiddenProcess -FilePath $serviceControlPath -Arguments "config iphlpsvc start= demand" -TimeoutMs 10000
  Write-ControllerLog "IP Helper is available for manual start."

  $tailscaleService = New-Object System.ServiceProcess.ServiceController("Tailscale")
  try {
    $tailscaleService.Refresh()
    if ($tailscaleService.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Stopped) {
      $tailscaleService.Start()
    }

    $tailscaleService.WaitForStatus(
      [System.ServiceProcess.ServiceControllerStatus]::Running,
      [TimeSpan]::FromSeconds(20)
    )
  } finally {
    $tailscaleService.Dispose()
  }

  Write-ControllerLog "Tailscale service is running."
  Invoke-HiddenProcess -FilePath $tailscalePath -Arguments "up --unattended=true" -TimeoutMs 20000
  Write-ControllerLog "Tailscale is connected."

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $nodePath
  $startInfo.Arguments = "apps/api/server.mjs"
  $startInfo.WorkingDirectory = $projectRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden

  $script:nodeProcess = [System.Diagnostics.Process]::Start($startInfo)
  if ($null -eq $script:nodeProcess) {
    throw "Node.js 服务没有成功启动。"
  }

  Write-ControllerLog "Node process started with PID $($script:nodeProcess.Id)."

  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    if ($script:nodeProcess.HasExited) {
      throw "Node.js 服务启动后立即退出。"
    }

    if (Test-LocalHealth) {
      Write-ControllerLog "Local health check passed."
      return
    }

    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 500
  }

  throw "石头启动超时，请关闭窗口后重试。"
}

function Stop-ServiceIfOwned {
  param(
    [Parameter(Mandatory = $true)][string]$ServiceName,
    [Parameter(Mandatory = $true)][int]$TimeoutSeconds
  )

  try {
    $service = New-Object System.ServiceProcess.ServiceController($ServiceName)
    try {
      $service.Refresh()
      if (
        $service.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Running -and
        $service.CanStop
      ) {
        $service.Stop()
        $service.WaitForStatus(
          [System.ServiceProcess.ServiceControllerStatus]::Stopped,
          [TimeSpan]::FromSeconds($TimeoutSeconds)
        )
      }
    } finally {
      $service.Dispose()
    }
  } catch {
    # Leave shared Windows services alone if another component is using them.
  }
}

function Stop-PrivateHost {
  Write-ControllerLog "Stopping private host controller (PowerShell host)."

  try {
    if ($null -ne $script:nodeProcess -and -not $script:nodeProcess.HasExited) {
      $script:nodeProcess.Kill()
      $script:nodeProcess.WaitForExit(5000) | Out-Null
    }
  } catch {
    # Continue disconnecting Tailscale even if Node has already stopped.
  } finally {
    if ($null -ne $script:nodeProcess) {
      $script:nodeProcess.Dispose()
      $script:nodeProcess = $null
    }
  }

  try {
    Invoke-HiddenProcess -FilePath $tailscalePath -Arguments "down" -TimeoutMs 10000
  } catch {
    # Stopping the Windows service below also closes the private route.
  }

  Stop-ServiceIfOwned -ServiceName "Tailscale" -TimeoutSeconds 20
  Stop-ServiceIfOwned -ServiceName "iphlpsvc" -TimeoutSeconds 10
}

$created = $false
$mutex = New-Object System.Threading.Mutex($true, "Global\ElectronicFriendPrivateHostController", [ref]$created)
if (-not $created) {
  $mutex.Dispose()
  exit 0
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "石头开关"
$form.Width = 380
$form.Height = 230
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.MaximizeBox = $false
$form.MinimizeBox = $true
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.BackColor = [System.Drawing.Color]::FromArgb(250, 247, 242)
if (Test-Path -LiteralPath $iconPath) {
  $form.Icon = New-Object System.Drawing.Icon($iconPath)
}

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.Text = "石头私人连接"
$titleLabel.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 16, [System.Drawing.FontStyle]::Bold)
$titleLabel.ForeColor = [System.Drawing.Color]::FromArgb(62, 54, 48)
$titleLabel.AutoSize = $true
$titleLabel.Left = 28
$titleLabel.Top = 24

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = "正在启动…"
$statusLabel.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 11, [System.Drawing.FontStyle]::Bold)
$statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(176, 116, 72)
$statusLabel.AutoSize = $true
$statusLabel.Left = 30
$statusLabel.Top = 70

$detailLabel = New-Object System.Windows.Forms.Label
$detailLabel.Text = "连接期间电脑会保持唤醒；关闭窗口即可断开。"
$detailLabel.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9)
$detailLabel.ForeColor = [System.Drawing.Color]::FromArgb(105, 96, 88)
$detailLabel.AutoSize = $false
$detailLabel.Width = 310
$detailLabel.Height = 42
$detailLabel.Left = 30
$detailLabel.Top = 100

$closeButton = New-Object System.Windows.Forms.Button
$closeButton.Text = "关闭石头"
$closeButton.Font = New-Object System.Drawing.Font("Microsoft YaHei UI", 9, [System.Drawing.FontStyle]::Bold)
$closeButton.Width = 116
$closeButton.Height = 34
$closeButton.Left = 224
$closeButton.Top = 150
$closeButton.Enabled = $false
$closeButton.BackColor = [System.Drawing.Color]::FromArgb(215, 92, 74)
$closeButton.ForeColor = [System.Drawing.Color]::White
$closeButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$closeButton.FlatAppearance.BorderSize = 0
$closeButton.Add_Click({ $form.Close() })

$form.Controls.Add($titleLabel)
$form.Controls.Add($statusLabel)
$form.Controls.Add($detailLabel)
$form.Controls.Add($closeButton)

$form.Add_Shown({
  [ElectronicFriendPowerRequest]::SetThreadExecutionState($keepAwakeFlag) | Out-Null

  try {
    Start-PrivateHost
    $statusLabel.Text = "石头已在线"
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(53, 132, 91)
    $detailLabel.Text = "iPhone 现在可以打开石头。关闭本窗口后，连接与防睡眠会一起停止。"
  } catch {
    Write-ControllerLog ($_ | Out-String)
    $statusLabel.Text = "启动失败"
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(190, 65, 55)
    $detailLabel.Text = $_.Exception.Message
  } finally {
    $closeButton.Enabled = $true
  }
})

$form.Add_FormClosing({
  param($sender, $eventArgs)

  if ($script:allowClose) {
    return
  }

  $eventArgs.Cancel = $true
  if ($script:cleanupStarted) {
    return
  }

  $script:cleanupStarted = $true
  $closeButton.Enabled = $false
  $statusLabel.Text = "正在断开…"
  $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(176, 116, 72)
  [System.Windows.Forms.Application]::DoEvents()

  Stop-PrivateHost
  [ElectronicFriendPowerRequest]::SetThreadExecutionState($releaseAwakeFlag) | Out-Null
  $script:allowClose = $true
  $form.Close()
})

try {
  [System.Windows.Forms.Application]::EnableVisualStyles()
  [System.Windows.Forms.Application]::Run($form)
} finally {
  [ElectronicFriendPowerRequest]::SetThreadExecutionState($releaseAwakeFlag) | Out-Null
  $mutex.ReleaseMutex()
  $mutex.Dispose()
  $form.Dispose()
}
