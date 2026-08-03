using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.ServiceProcess;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Runtime.InteropServices;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        bool created;
        using (var mutex = new Mutex(true, @"Global\ElectronicFriendPrivateHostController", out created))
        {
            if (!created)
            {
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new ControllerForm());
        }
    }
}

internal sealed class ControllerForm : Form
{
    private const uint EsContinuous = 0x80000000;
    private const uint EsSystemRequired = 0x00000001;

    private readonly string projectRoot;
    private readonly string nodePath;
    private readonly string tailscalePath;
    private readonly string serviceControlPath;
    private readonly string logPath;
    private readonly Label statusLabel;
    private readonly Label detailLabel;
    private readonly Button closeButton;
    private Process nodeProcess;
    private bool allowClose;
    private bool cleanupStarted;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint SetThreadExecutionState(uint flags);

    public ControllerForm()
    {
        projectRoot = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", ".."));
        nodePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
        tailscalePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Tailscale", "tailscale.exe");
        serviceControlPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "sc.exe");
        logPath = Path.Combine(projectRoot, "data", "private-host-controller.log");

        Text = "石头开关";
        Width = 380;
        Height = 230;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = true;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(250, 247, 242);

        var titleLabel = new Label
        {
            Text = "石头私人连接",
            Font = new Font("Microsoft YaHei UI", 16F, FontStyle.Bold),
            ForeColor = Color.FromArgb(62, 54, 48),
            AutoSize = true,
            Left = 28,
            Top = 24
        };

        statusLabel = new Label
        {
            Text = "正在启动…",
            Font = new Font("Microsoft YaHei UI", 11F, FontStyle.Bold),
            ForeColor = Color.FromArgb(176, 116, 72),
            AutoSize = true,
            Left = 30,
            Top = 70
        };

        detailLabel = new Label
        {
            Text = "连接期间电脑会保持唤醒；关闭窗口即可断开。",
            Font = new Font("Microsoft YaHei UI", 9F),
            ForeColor = Color.FromArgb(105, 96, 88),
            AutoSize = false,
            Width = 310,
            Height = 42,
            Left = 30,
            Top = 100
        };

        closeButton = new Button
        {
            Text = "关闭石头",
            Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Bold),
            Width = 116,
            Height = 34,
            Left = 224,
            Top = 150,
            Enabled = false,
            BackColor = Color.FromArgb(215, 92, 74),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat
        };
        closeButton.FlatAppearance.BorderSize = 0;
        closeButton.Click += delegate { Close(); };

        Controls.Add(titleLabel);
        Controls.Add(statusLabel);
        Controls.Add(detailLabel);
        Controls.Add(closeButton);

        Shown += OnShown;
        FormClosing += OnFormClosing;
    }

    private async void OnShown(object sender, EventArgs e)
    {
        // This request belongs to the UI thread and is automatically released when the app exits.
        SetThreadExecutionState(EsContinuous | EsSystemRequired);

        try
        {
            await Task.Run((Action)StartHost);
            statusLabel.Text = "石头已在线";
            statusLabel.ForeColor = Color.FromArgb(53, 132, 91);
            detailLabel.Text = "iPhone 现在可以打开石头。关闭本窗口后，连接与防睡眠会一起停止。";
        }
        catch (Exception ex)
        {
            Log(ex.ToString());
            statusLabel.Text = "启动失败";
            statusLabel.ForeColor = Color.FromArgb(190, 65, 55);
            detailLabel.Text = ex.Message;
        }
        finally
        {
            closeButton.Enabled = true;
        }
    }

    private void StartHost()
    {
        Log("Starting private host controller.");
        if (!File.Exists(nodePath))
        {
            throw new FileNotFoundException("没有找到 Node.js。", nodePath);
        }

        if (!File.Exists(tailscalePath))
        {
            throw new FileNotFoundException("没有找到 Tailscale。", tailscalePath);
        }

        // Some Windows tuning tools disable IP Helper, but Tailscale declares it as a dependency.
        // Manual start keeps it off when unused while allowing this controller to connect on demand.
        RunHidden(serviceControlPath, "config iphlpsvc start= demand", 10000);
        Log("IP Helper is available for manual start.");

        using (var service = new ServiceController("Tailscale"))
        {
            service.Refresh();
            if (service.Status == ServiceControllerStatus.Stopped)
            {
                service.Start();
            }

            service.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(20));
        }

        Log("Tailscale service is running.");
        RunHidden(tailscalePath, "up --unattended=true", 20000);
        Log("Tailscale is connected.");

        var startInfo = new ProcessStartInfo
        {
            FileName = nodePath,
            Arguments = "apps/api/server.mjs",
            WorkingDirectory = projectRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };

        nodeProcess = Process.Start(startInfo);
        if (nodeProcess == null)
        {
            throw new InvalidOperationException("Node.js 服务没有成功启动。") ;
        }

        Log("Node process started with PID " + nodeProcess.Id + ".");

        for (var attempt = 0; attempt < 20; attempt++)
        {
            if (nodeProcess.HasExited)
            {
                throw new InvalidOperationException("Node.js 服务启动后立即退出。") ;
            }

            if (HealthCheck())
            {
                Log("Local health check passed.");
                return;
            }

            Thread.Sleep(500);
        }

        throw new System.TimeoutException("石头启动超时，请关闭窗口后重试。") ;
    }

    private bool HealthCheck()
    {
        try
        {
            var request = WebRequest.CreateHttp("http://127.0.0.1:3001/api/health");
            request.Timeout = 1000;
            using (var response = (HttpWebResponse)request.GetResponse())
            {
                return response.StatusCode == HttpStatusCode.OK;
            }
        }
        catch
        {
            return false;
        }
    }

    private async void OnFormClosing(object sender, FormClosingEventArgs e)
    {
        if (allowClose)
        {
            return;
        }

        e.Cancel = true;
        if (cleanupStarted)
        {
            return;
        }

        cleanupStarted = true;
        closeButton.Enabled = false;
        statusLabel.Text = "正在断开…";
        statusLabel.ForeColor = Color.FromArgb(176, 116, 72);

        await Task.Run((Action)StopHost);

        // Releasing ES_SYSTEM_REQUIRED restores the user's normal Windows power policy.
        SetThreadExecutionState(EsContinuous);
        allowClose = true;
        Close();
    }

    private void StopHost()
    {
        Log("Stopping private host controller.");
        try
        {
            if (nodeProcess != null && !nodeProcess.HasExited)
            {
                nodeProcess.Kill();
                nodeProcess.WaitForExit(5000);
            }
        }
        catch
        {
            // Continue disconnecting Tailscale even if Node has already stopped.
        }
        finally
        {
            if (nodeProcess != null)
            {
                nodeProcess.Dispose();
                nodeProcess = null;
            }
        }

        try
        {
            RunHidden(tailscalePath, "down", 10000);
        }
        catch
        {
            // The Windows service is stopped below, which also closes the private route.
        }

        try
        {
            using (var service = new ServiceController("Tailscale"))
            {
                service.Refresh();
                if (service.Status != ServiceControllerStatus.Stopped &&
                    service.Status != ServiceControllerStatus.StopPending)
                {
                    service.Stop();
                }

                if (service.Status != ServiceControllerStatus.Stopped)
                {
                    service.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(20));
                }
            }
        }
        catch
        {
            // Windows shutdown will stop the service even if it is already transitioning.
        }

        TryStopService("iphlpsvc");
    }

    private static void TryStopService(string serviceName)
    {
        try
        {
            using (var service = new ServiceController(serviceName))
            {
                service.Refresh();
                if (service.Status == ServiceControllerStatus.Running && service.CanStop)
                {
                    service.Stop();
                    service.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(10));
                }
            }
        }
        catch
        {
            // Leave shared Windows services alone if another component is using them.
        }
    }

    private void Log(string message)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(logPath));
            File.AppendAllText(logPath, DateTime.Now.ToString("s") + " " + message + Environment.NewLine);
        }
        catch
        {
            // Diagnostics must never prevent start or stop.
        }
    }

    private static void RunHidden(string executable, string arguments, int timeoutMs)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = executable,
            Arguments = arguments,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };

        using (var process = Process.Start(startInfo))
        {
            if (process == null)
            {
                throw new InvalidOperationException("无法启动 " + Path.GetFileName(executable));
            }

            if (!process.WaitForExit(timeoutMs))
            {
                process.Kill();
                throw new System.TimeoutException(Path.GetFileName(executable) + " 响应超时。") ;
            }

            if (process.ExitCode != 0)
            {
                throw new InvalidOperationException(Path.GetFileName(executable) + " 返回错误 " + process.ExitCode + "。") ;
            }
        }
    }
}
