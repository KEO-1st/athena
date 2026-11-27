using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

/*
 * ATHENA Hub desktop launcher.
 *
 * Starts the bundled Node runtime with server.mjs, waits for the real health
 * endpoint, and presents the Hub in an embedded WebView2 window. The window is
 * owned by this process: closing or minimising it hides the Hub to the tray
 * while controllers and the server keep running. Quit from the tray stops it.
 *
 * Not an installer, service or registry entry. Everything stays in this folder
 * and its data\ directory.
 */
namespace AthenaHub
{
    internal static class Program
    {
        private const string MutexName = "ATHENA.Hub.Launcher";
        private const string OpenEventName = "ATHENA.Hub.OpenWindow";

        [STAThread]
        private static void Main(string[] args)
        {
            bool created;
            using (var mutex = new Mutex(true, MutexName, out created))
            using (var openEvent = new EventWaitHandle(false, EventResetMode.AutoReset, OpenEventName))
            {
                if (!created)
                {
                    try { openEvent.Set(); } catch { }
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new HubContext(openEvent));
            }
        }
    }

    internal sealed class HubContext : ApplicationContext
    {
        private readonly NotifyIcon tray;
        private readonly Control marshal;
        private readonly EventWaitHandle openEvent;
        private readonly System.Windows.Forms.Timer restartTimer;
        private readonly string root;
        private readonly string server;
        private readonly string runtime;
        private readonly string dataDir;
        private readonly string logFile;
        private Process child;
        private Form window;
        private WebView2 web;
        private bool coreReady;
        private bool serverReady;
        private bool quitting;
        private bool closeAllowed;
        private bool navigated;
        private int port = 4790;
        private int restartCount;

        public HubContext(EventWaitHandle openEvent)
        {
            this.openEvent = openEvent;
            root = AppDomain.CurrentDomain.BaseDirectory;
            server = Path.Combine(root, "server.mjs");
            string bundled = Path.Combine(root, "runtime", "node.exe");
            runtime = File.Exists(bundled) ? bundled : "node";
            dataDir = Path.Combine(root, "data");
            Directory.CreateDirectory(dataDir);
            logFile = Path.Combine(dataDir, "hub-launcher.log");
            port = ReadPort();

            if (!File.Exists(server))
            {
                MessageBox.Show("server.mjs is missing next to this executable.\nExtract the whole ATHENA Hub folder, not just the .exe.",
                    "ATHENA Hub", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            var menu = new ContextMenu();
            menu.MenuItems.Add("Open ATHENA Hub", delegate { ShowWindow(); });
            menu.MenuItems.Add("Copy hub address", delegate { CopyAddress(); });
            menu.MenuItems.Add("Open in browser", delegate { OpenInBrowser(); });
            menu.MenuItems.Add("Restart hub", delegate { RestartServer(); });
            menu.MenuItems.Add("Open data folder", delegate { try { Process.Start("explorer.exe", dataDir); } catch { } });
            menu.MenuItems.Add("-");
            menu.MenuItems.Add("Quit", delegate { Quit(); });

            tray = new NotifyIcon();
            tray.Icon = LoadIcon();
            tray.Text = "ATHENA Hub - starting";
            tray.ContextMenu = menu;
            tray.Visible = true;
            tray.DoubleClick += delegate { ShowWindow(); };

            marshal = new Control();
            marshal.CreateControl();

            restartTimer = new System.Windows.Forms.Timer();
            restartTimer.Interval = 1000;
            restartTimer.Tick += delegate
            {
                restartTimer.Stop();
                if (!quitting) StartServer();
            };

            var signal = new Thread(delegate()
            {
                while (!quitting)
                {
                    try
                    {
                        if (!openEvent.WaitOne(1000)) continue;
                        if (quitting) return;
                        try { marshal.BeginInvoke((Action)ShowWindow); } catch { }
                    }
                    catch { return; }
                }
            });
            signal.IsBackground = true;
            signal.Start();

            ShowWindow();
            StartServer();
        }

        private static Icon LoadIcon()
        {
            try
            {
                string file = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "assets", "athena.ico");
                if (File.Exists(file)) return new Icon(file);
            }
            catch { }
            try
            {
                Icon associated = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (associated != null) return associated;
            }
            catch { }
            return SystemIcons.Application;
        }

        private int ReadPort()
        {
            try
            {
                string config = Path.Combine(dataDir, "config.json");
                if (!File.Exists(config)) return 4790;
                Match match = Regex.Match(File.ReadAllText(config), "\"port\"\\s*:\\s*(\\d+)");
                if (match.Success)
                {
                    int value;
                    if (Int32.TryParse(match.Groups[1].Value, out value) && value > 1024 && value < 65535) return value;
                }
            }
            catch { }
            return 4790;
        }

        private void StartServer()
        {
            if (quitting || (child != null && !child.HasExited)) return;
            serverReady = false;
            navigated = false;
            try
            {
                var info = new ProcessStartInfo();
                info.FileName = runtime;
                info.Arguments = "\"" + server + "\"";
                info.WorkingDirectory = root;
                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                info.RedirectStandardOutput = true;
                info.RedirectStandardError = true;
                info.StandardOutputEncoding = Encoding.UTF8;
                info.StandardErrorEncoding = Encoding.UTF8;
                info.EnvironmentVariables["ATHENA_LAUNCHED_BY"] = "desktop";

                child = new Process();
                child.StartInfo = info;
                child.EnableRaisingEvents = true;
                child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { WriteLog(e.Data); };
                child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { WriteLog(e.Data); };
                var started = child;
                child.Exited += delegate(object sender, EventArgs e) { ServerExited(started); };
                child.Start();
                child.BeginOutputReadLine();
                child.BeginErrorReadLine();
                WriteLog("launcher started hub pid " + child.Id + " (port " + port + ")");
                tray.Text = "ATHENA Hub - starting";
                WaitForHealth();
            }
            catch (Exception error)
            {
                WriteLog("hub start failed: " + error);
                child = null;
                tray.ShowBalloonTip(7000, "ATHENA Hub could not start",
                    error.Message + "\n\nInstall Node.js 20+ or use the full package with runtime\\node.exe.", ToolTipIcon.Error);
            }
        }

        private void WaitForHealth()
        {
            var thread = new Thread(delegate()
            {
                for (int attempt = 0; attempt < 120; attempt++)
                {
                    if (quitting || child == null || child.HasExited) return;
                    if (Healthy())
                    {
                        serverReady = true;
                        tray.Text = "ATHENA Hub - running on " + port;
                        try { marshal.BeginInvoke((Action)SyncWindow); } catch { }
                        return;
                    }
                    Thread.Sleep(200);
                }
                try
                {
                    tray.ShowBalloonTip(7000, "ATHENA Hub is not answering",
                        "The server did not become healthy. Read data\\hub-launcher.log, then use Restart hub from the tray.", ToolTipIcon.Warning);
                }
                catch { }
            });
            thread.IsBackground = true;
            thread.Start();
        }

        private bool Healthy()
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/health");
                request.Timeout = 900;
                request.ReadWriteTimeout = 900;
                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    return response.StatusCode == HttpStatusCode.OK;
                }
            }
            catch { return false; }
        }

        private void ServerExited(Process source)
        {
            if (source != child) return;
            if (marshal.InvokeRequired)
            {
                try { marshal.BeginInvoke((Action)delegate { OnServerExit(source); }); } catch { }
                return;
            }
            OnServerExit(source);
        }

        private void OnServerExit(Process source)
        {
            if (source != child) return;
            int code = -1;
            try { code = source.ExitCode; } catch { }
            WriteLog("hub exited with code " + code);
            child = null;
            serverReady = false;
            if (quitting) return;
            tray.Text = "ATHENA Hub - stopped";
            if (restartCount < 2)
            {
                restartCount++;
                tray.ShowBalloonTip(4000, "ATHENA Hub stopped",
                    "Restarting in a moment (attempt " + restartCount + " of 2).", ToolTipIcon.Warning);
                restartTimer.Interval = 1200 * restartCount;
                restartTimer.Start();
            }
            else
            {
                tray.ShowBalloonTip(8000, "ATHENA Hub stopped",
                    "It exited with code " + code + ". Read data\\hub-launcher.log, then use Restart hub from the tray.", ToolTipIcon.Error);
            }
        }

        private void RestartServer()
        {
            if (quitting) return;
            restartCount = 0;
            var process = child;
            child = null;
            if (process != null)
            {
                try { if (!process.HasExited) { Process.Start(new ProcessStartInfo("taskkill", "/pid " + process.Id + " /t /f") { UseShellExecute = false, CreateNoWindow = true }); process.WaitForExit(5000); } } catch { }
            }
            tray.Text = "ATHENA Hub - restarting";
            serverReady = false;
            restartTimer.Interval = 500;
            restartTimer.Start();
        }

        private void ShowWindow()
        {
            if (quitting) return;
            if (window != null && !window.IsDisposed)
            {
                if (window.WindowState == FormWindowState.Minimized) window.WindowState = FormWindowState.Normal;
                window.Show();
                window.WindowState = FormWindowState.Normal;
                window.Activate();
                window.BringToFront();
                SyncWindow();
                return;
            }

            window = new Form();
            window.Text = "ATHENA Hub";
            window.Width = 1320;
            window.Height = 900;
            window.MinimumSize = new Size(880, 600);
            window.StartPosition = FormStartPosition.CenterScreen;
            window.BackColor = Color.FromArgb(4, 5, 10);
            window.Icon = LoadIcon();
            window.ShowInTaskbar = true;

            web = new WebView2();
            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = Color.FromArgb(4, 5, 10);
            window.Controls.Add(web);

            window.FormClosing += delegate(object sender, FormClosingEventArgs e)
            {
                if (quitting || closeAllowed) return;
                if (e.CloseReason == CloseReason.UserClosing)
                {
                    e.Cancel = true;
                    HideWindow();
                }
            };
            window.Resize += delegate
            {
                if (quitting) return;
                if (window.WindowState == FormWindowState.Minimized)
                {
                    window.Hide();
                    ShowBackgroundNotice();
                }
            };
            window.Shown += async delegate { await LoadShellAsync(); };
            window.Show();
        }

        private async Task LoadShellAsync()
        {
            try
            {
                string profile = Path.Combine(dataDir, "hub-webview");
                Directory.CreateDirectory(profile);
                var environment = await CoreWebView2Environment.CreateAsync(null, profile, null);
                await web.EnsureCoreWebView2Async(environment);
                var core = web.CoreWebView2;
                if (core == null) throw new Exception("WebView2 did not create a browser core.");
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.IsSwipeNavigationEnabled = false;
                core.WebMessageReceived += delegate(object sender, CoreWebView2WebMessageReceivedEventArgs e)
                {
                    try
                    {
                        string message = e.TryGetWebMessageAsString();
                        if (!String.IsNullOrEmpty(message) && message.IndexOf("hide-window", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            HideWindow();
                        }
                    }
                    catch { }
                };
                core.NavigateToString(
                    "<!doctype html><meta charset='utf-8'><style>" +
                    "html,body{height:100%;margin:0;background:#04050a;color:#ece8de;font-family:Segoe UI,system-ui,sans-serif;display:grid;place-items:center}" +
                    ".b{text-align:center}.m{font:11px Consolas,monospace;letter-spacing:.3em;color:#d8a94e}.h{font-size:26px;letter-spacing:.18em;margin:14px 0 8px}" +
                    ".p{color:#8b8791;font-size:13px}.o{width:38px;height:38px;margin:22px auto 0;border:1px solid rgba(216,169,78,.4);border-top-color:#f4d79e;border-radius:50%;animation:s 1s linear infinite}" +
                    "@keyframes s{to{transform:rotate(360deg)}}</style>" +
                    "<div class='b'><div class='m'>ATHENA HUB</div><div class='h'>STARTING THE HUB</div>" +
                    "<div class='p'>The local server is starting. This window becomes the Hub when it answers.</div><div class='o'></div></div>");
                coreReady = true;
                WriteLog("embedded hub window ready (WebView2 " + core.Environment.BrowserVersionString + ")");
                SyncWindow();
            }
            catch (Exception error)
            {
                coreReady = false;
                WriteLog("WebView2 failed: " + error);
                var choice = MessageBox.Show(
                    "The embedded ATHENA Hub window could not start because the Microsoft WebView2 runtime is missing or damaged.\n\n" +
                    error.Message + "\n\nOpen the Hub in your default browser instead?",
                    "ATHENA Hub", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
                if (choice == DialogResult.Yes) OpenInBrowser();
            }
        }

        private void SyncWindow()
        {
            if (!coreReady || !serverReady || web == null || web.CoreWebView2 == null) return;
            if (navigated) return;
            try
            {
                web.CoreWebView2.Navigate("http://127.0.0.1:" + port + "/");
                navigated = true;
                window.Text = "ATHENA Hub - 127.0.0.1:" + port;
            }
            catch (Exception error)
            {
                WriteLog("navigate failed: " + error);
            }
        }

        private void HideWindow()
        {
            if (window == null || window.IsDisposed) return;
            window.Hide();
            ShowBackgroundNotice();
        }

        private void ShowBackgroundNotice()
        {
            if (quitting) return;
            try
            {
                tray.ShowBalloonTip(4500, "ATHENA Hub is still running",
                    "The window is closed, but the Hub server and this PC's controllers stay connected. Open it again from the tray.", ToolTipIcon.Info);
            }
            catch { }
        }

        private void CopyAddress()
        {
            try
            {
                Clipboard.SetText("http://127.0.0.1:" + port + "/");
                tray.ShowBalloonTip(2200, "Hub address copied", "http://127.0.0.1:" + port + "/", ToolTipIcon.Info);
            }
            catch { }
        }

        private void OpenInBrowser()
        {
            try { Process.Start(new ProcessStartInfo("http://127.0.0.1:" + port + "/") { UseShellExecute = true }); } catch { }
        }

        private void WriteLog(string line)
        {
            if (String.IsNullOrEmpty(line)) return;
            try
            {
                File.AppendAllText(logFile, DateTime.UtcNow.ToString("o") + " " + line + Environment.NewLine, new UTF8Encoding(false));
            }
            catch { }
        }

        private void Quit()
        {
            quitting = true;
            restartTimer.Stop();
            var process = child;
            child = null;
            if (process != null)
            {
                try
                {
                    if (!process.HasExited)
                    {
                        Process.Start(new ProcessStartInfo("taskkill", "/pid " + process.Id + " /t /f") { UseShellExecute = false, CreateNoWindow = true });
                        process.WaitForExit(5000);
                    }
                }
                catch { }
            }
            closeAllowed = true;
            try { if (window != null && !window.IsDisposed) window.Close(); } catch { }
            try { if (web != null) web.Dispose(); } catch { }
            try { openEvent.Set(); } catch { }
            tray.Visible = false;
            tray.Dispose();
            ExitThread();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                if (tray != null) tray.Dispose();
                if (marshal != null) marshal.Dispose();
                if (restartTimer != null) restartTimer.Dispose();
                if (web != null) web.Dispose();
                if (window != null) window.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
