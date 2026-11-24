using System;
using System.Diagnostics;
using System.IO;
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
            Console.Error.WriteLine("server.mjs is missing next to this executable.");
            Console.Error.WriteLine("Extract the whole ATHENA Hub folder, not just the .exe.");
            return 2;
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
            Console.Error.WriteLine("Could not start the bundled Node runtime: " + error.Message);
            Console.Error.WriteLine("Expected: " + runtime);
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

        /* The hub prints its address and code before this opens. */
        var opener = new Thread(delegate()
        {
            Thread.Sleep(3000);
            try
            {
                Process.Start(new ProcessStartInfo("http://127.0.0.1:" + port + "/") { UseShellExecute = true });
            }
            catch
            {
                /* the address is printed in the hub window */
            }
        });
        opener.IsBackground = true;
        opener.Start();

        hub.WaitForExit();
        return hub.ExitCode;
    }
}
