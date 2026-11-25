using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;

/*
 * ATHENA Hub launcher.
 *
 * It does one thing: start the Node runtime that ships beside it, with
 * server.mjs, in this folder. No registry writes, no install, no copy of the
 * user's data. The console window is the hub window, exactly like the old
 * Start Athena.cmd, but this is a real executable that can be double-clicked
 * from Explorer or pinned to the taskbar.
 */
internal static class Program
{
    private static int Main(string[] args)
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string runtime = Path.Combine(root, "runtime", "node.exe");
        string node = File.Exists(runtime) ? runtime : "node";
        string server = Path.Combine(root, "server.mjs");

        if (!File.Exists(server))
        {
            Fail("server.mjs is missing next to this executable.\nExtract the whole ATHENA Hub folder, not just the .exe.");
            return 2;
        }

        if (!File.Exists(runtime))
        {
            Console.Error.WriteLine("Bundled runtime not found: " + runtime);
            Console.Error.WriteLine("Falling back to a Node.js 20+ installation on PATH.");
        }

        var start = new ProcessStartInfo
        {
            FileName = node,
            Arguments = "\"" + server + "\"",
            WorkingDirectory = root,
            UseShellExecute = false,
        };

        Process hub;
        try
        {
            hub = Process.Start(start);
        }
        catch (Exception error)
        {
            Fail("Could not start the ATHENA Hub runtime: " + error.Message +
                 "\nExpected: " + runtime +
                 "\nInstall Node.js 20+ or use the full package with runtime\\node.exe.");
            return 3;
        }

        if (hub == null) return 3;

        /* Respect a port the user already changed in data/config.json. */
        int port = 4790;
        string config = Path.Combine(root, "data", "config.json");
        if (File.Exists(config))
        {
            try
            {
                var match = System.Text.RegularExpressions.Regex.Match(File.ReadAllText(config), "\\\"port\\\"\\s*:\\s*(\\d+)");
                if (match.Success) port = int.Parse(match.Groups[1].Value);
            }
            catch
            {
                /* keep the default */
            }
        }

        /* Wait for the real health endpoint instead of guessing at a delay.
           A first start on a slow disk can take longer than three seconds;
           opening early leaves the user staring at a connection error. */
        var opener = new Thread(delegate()
        {
            string health = "http://127.0.0.1:" + port + "/api/health";
            bool ready = false;
            for (int attempt = 0; attempt < 100 && !hub.HasExited; attempt++)
            {
                try
                {
                    var request = (HttpWebRequest)WebRequest.Create(health);
                    request.Timeout = 700;
                    request.ReadWriteTimeout = 700;
                    using (var response = (HttpWebResponse)request.GetResponse())
                    {
                        if ((int)response.StatusCode == 200) ready = true;
                    }
                }
                catch
                {
                    /* not listening yet */
                }
                if (ready) break;
                Thread.Sleep(150);
            }
            if (ready)
            {
                try
                {
                    Process.Start(new ProcessStartInfo("http://127.0.0.1:" + port + "/") { UseShellExecute = true });
                }
                catch
                {
                    /* the address is printed in the hub window */
                }
            }
        });
        opener.IsBackground = true;
        opener.Start();

        hub.WaitForExit();
        return hub.ExitCode;
    }

    /* A double-clicked console closes immediately, hiding the reason. Pause
       only on failure so a successful hub window behaves exactly as before. */
    private static void Fail(string message)
    {
        Console.Error.WriteLine(message);
        try
        {
            Console.Error.WriteLine("Press Enter to close.");
            Console.ReadLine();
        }
        catch
        {
            /* no console attached */
        }
    }
}
