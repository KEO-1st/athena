using Godot;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

namespace AthenaDesktop;

/// <summary>
/// ATHENA // ASTRAL COMMAND. A native Godot 4 C# environment: no browser,
/// no WebView2, no HTML, and no bundled server. Hub and Node remain separate.
/// </summary>
public partial class Main : Node3D
{
    private sealed class ProfileSpec
    {
        public string Name { get; }
        public float ResolutionScale { get; }
        public int TargetFps { get; }
        public int Stars { get; }
        public int Motes { get; }
        public bool Shadows { get; }
        public bool Reflections { get; }
        public int Lights { get; }
        public float Animation { get; }
        public bool Glow { get; }

        public ProfileSpec(string name, float scale, int fps, int stars, int motes, bool shadows,
            bool reflections, int lights, float animation, bool glow)
        {
            Name = name;
            ResolutionScale = scale;
            TargetFps = fps;
            Stars = stars;
            Motes = motes;
            Shadows = shadows;
            Reflections = reflections;
            Lights = lights;
            Animation = animation;
            Glow = glow;
        }
    }

    private sealed class AstralButton
    {
        public string Id = "";
        public StaticBody3D Body = null!;
        public MeshInstance3D Face = null!;
        public MeshInstance3D Accent = null!;
        public Label3D Text = null!;
        public StandardMaterial3D Material = null!;
        public Color BaseColor;
        public bool IsProfile;
        public bool Enabled = true;

        public void SetEnabled(bool enabled)
        {
            Enabled = enabled;
            Body.CollisionLayer = enabled ? 2u : 0u;
            Text.Modulate = enabled ? AthenaVisuals.PaleGold : new Color(0.48f, 0.42f, 0.31f, 0.65f);
            Face.Transparency = 0f;
        }
    }

    private sealed class Orbiter
    {
        public MeshInstance3D Mesh = null!;
        public float Radius;
        public float Height;
        public float Speed;
        public float Phase;
    }

    private readonly ProfileSpec[] _profiles =
    {
        new("ULTRA", 1.00f, 0, 1800, 180, true, true, 3, 1.00f, true),
        new("HIGH", 0.86f, 60, 1200, 120, true, true, 2, 1.00f, true),
        new("BALANCED", 0.72f, 45, 700, 72, true, false, 2, 0.72f, true),
        new("COMPATIBILITY", 0.56f, 30, 320, 36, false, false, 1, 0.35f, false),
    };

    private readonly List<AstralButton> _buttons = new();
    private readonly List<AstralButton> _detailButtons = new();
    private readonly Dictionary<ulong, AstralButton> _buttonByBody = new();
    private readonly List<Node3D> _rings = new();
    private readonly List<Orbiter> _orbiters = new();
    private readonly List<Node3D> _monuments = new();
    private readonly Queue<double> _frameTimes = new();
    private readonly List<double> _benchmarkFrames = new();
    private readonly List<string> _benchmarkLines = new();

    private AstralButton? _hover;
    private AstralButton? _closeButton;
    private readonly AstralButton?[] _profileButtons = new AstralButton?[4];

    private Node3D _cameraRig = null!;
    private Camera3D _camera = null!;
    private Node3D _core = null!;
    private Node3D _detailRoot = null!;
    private Node3D _commandRoot = null!;
    private Node3D _profileRoot = null!;
    private Label3D _detailTitle = null!;
    private Label3D _detailSub = null!;
    private Label3D _detailBanner = null!;
    private Label3D _detailBody = null!;
    private Node3D _detailButtonRoot = null!;
    private DirectionalLight3D _keyLight = null!;
    private DirectionalLight3D _rimLight = null!;
    private OmniLight3D _coreLight = null!;
    private OmniLight3D _accentA = null!;
    private OmniLight3D _accentB = null!;
    private ReflectionProbe _probe = null!;
    private Godot.Environment _environment = null!;
    private GpuParticles3D _starParticles = null!;
    private GpuParticles3D _motes = null!;

    private CanvasLayer _hud = null!;
    private Label _hudStats = null!;
    private Label _hudMode = null!;
    private Label _hudStatus = null!;
    private Label _hudBridge = null!;
    private SystemFont _displayFont = null!;
    private SystemFont _monoFont = null!;

    private ImageTexture _starTexture = null!;
    private ImageTexture _glowTexture = null!;
    private ImageTexture _dustTexture = null!;

    private IAthenaDataSource _dataSource = null!;
    private AthenaSnapshot _snapshot = null!;
    private readonly Process _process = Process.GetCurrentProcess();

    private string _section = "";
    private bool _detailOpen;
    private bool _detailAnimating;
    private Vector3 _detailOpenPosition;
    private Vector3 _detailClosedPosition;
    private float _detailBaseY;
    private float _commandBaseY;
    private float _profileBaseY;

    private float _yawDegrees;
    private float _pitchDegrees = -6f;
    private float _targetDistance = 13.2f;
    private bool _orbiting;
    private bool _leftDown;
    private bool _rightDown;
    private bool _dragged;
    private Vector2 _pressPosition;
    private double _lastInteraction;
    private bool _cursorPointing;

    private int _profileIndex = 1;
    private float _animationScale = 1f;
    private bool _vsync = true;
    private bool _fullscreen;
    private bool _glowEnabled = true;

    private double _uptime;
    private double _fps = 60;
    private double _frameMs = 16.6;
    private double _cpuPercent;
    private double _lastCpuMs;
    private DateTime _lastCpuStamp = DateTime.UtcNow;
    private long _workingSetMb;
    private int _drawCalls;
    private double _hudClock;
    private double _statusUntil;

    private bool _benchmark;
    private string _benchmarkPath = "user://athena-benchmark.csv";
    private int _benchProfile = -1;
    private double _benchElapsed;
    private long _benchMemoryPeak;
    private long _benchDrawTotal;
    private int _benchDrawSamples;

    private string? _captureDirectory;
    private bool _captureRequested;
    private bool _demoRequested;
    private bool _quitting;

    public override void _Ready()
    {
        string[] userArgs = OS.GetCmdlineUserArgs();
        string[] args = userArgs.Length > 0 ? userArgs : OS.GetCmdlineArgs();
        _dataSource = AthenaBridge.Create(args);
        _snapshot = _dataSource.Read();

        DisplayServer.WindowSetTitle("ATHENA // Astral Command");
        GetWindow().MinSize = new Vector2I(960, 620);

        _displayFont = new SystemFont
        {
            FontNames = new[] { "Cinzel", "Trajan Pro", "Georgia", "Cambria" },
            AllowSystemFallback = true,
        };
        _monoFont = new SystemFont
        {
            FontNames = new[] { "Cascadia Mono", "Consolas", "Lucida Console" },
            AllowSystemFallback = true,
        };

        _starTexture = AthenaVisuals.StarTexture(128);
        _glowTexture = AthenaVisuals.GlowTexture(128);
        _dustTexture = AthenaVisuals.DustTexture(48);

        BuildEnvironment();
        BuildCamera();
        BuildAstralEnvironment();
        BuildCore();
        BuildMonuments();
        BuildInterface();
        ApplyProfile(1, false);
        RefreshDetail();

        ParseLaunchModes(args);
        _hudBridge.Text = "SOURCE // " + _dataSource.Describe();

        GD.Print("ATHENA native 3D prototype ready. WebView2: NO. Renderer: " +
                 (string)ProjectSettings.GetSetting("rendering/renderer/rendering_method"));
    }

    public override void _Process(double delta)
    {
        if (_quitting) return;
        _uptime += delta;

        UpdateCamera(delta);
        UpdateWorld(delta);
        UpdateMetrics(delta);
        UpdateHover();
        UpdateHud(delta);
        UpdateBenchmark(delta);
    }

    private void ParseLaunchModes(string[] args)
    {
        GD.Print("ARGS // " + string.Join(" | ", args));
        foreach (string arg in args)
        {
            if (arg == "--benchmark" || arg.StartsWith("--benchmark=", StringComparison.Ordinal))
            {
                _benchmark = true;
                if (arg.StartsWith("--benchmark=", StringComparison.Ordinal))
                    _benchmarkPath = arg["--benchmark=".Length..];
                else
                {
                    int index = Array.IndexOf(args, arg);
                    if (index >= 0 && index + 1 < args.Length && !args[index + 1].StartsWith("--"))
                        _benchmarkPath = args[index + 1];
                }
            }

            if (arg == "--demo")
            {
                _demoRequested = true;
            }

            if (arg == "--capture" || arg.StartsWith("--capture=", StringComparison.Ordinal))
            {
                _captureRequested = true;
                _captureDirectory = arg.StartsWith("--capture=", StringComparison.Ordinal)
                    ? arg["--capture=".Length..]
                    : Path.Combine(ProjectSettings.GlobalizePath("user://"), "captures");
            }
        }

        if (_benchmark)
        {
            BeginBenchmark();
        }
        else if (_captureRequested && !string.IsNullOrWhiteSpace(_captureDirectory))
        {
            _ = CaptureSequence(_captureDirectory!);
        }
        else if (_demoRequested)
        {
            _ = DemoSequence();
        }
    }

    /// <summary>
    /// A hands-off interaction pass used for the short demonstration recording.
    /// It drives the same input handlers as a user, not a separate video path.
    /// </summary>
    private async System.Threading.Tasks.Task DemoSequence()
    {
        await ToSignal(GetTree().CreateTimer(2.2), "timeout");
        GD.Print("DEMO // system");
        OpenSection("system");
        await ToSignal(GetTree().CreateTimer(2.4), "timeout");
        GD.Print("DEMO // node");
        OpenSection("node");
        await ToSignal(GetTree().CreateTimer(2.4), "timeout");
        GD.Print("DEMO // settings");
        OpenSection("settings");
        await ToSignal(GetTree().CreateTimer(1.8), "timeout");
        GD.Print("DEMO // ultra");
        ApplyProfile(0, true);
        await ToSignal(GetTree().CreateTimer(2.0), "timeout");
        GD.Print("DEMO // compatibility");
        ApplyProfile(3, true);
        await ToSignal(GetTree().CreateTimer(2.0), "timeout");
        GD.Print("DEMO // high");
        ApplyProfile(1, true);
        await ToSignal(GetTree().CreateTimer(1.8), "timeout");
        GD.Print("DEMO // glow off");
        ToggleGlow();
        await ToSignal(GetTree().CreateTimer(1.2), "timeout");
        GD.Print("DEMO // glow on");
        ToggleGlow();
        await ToSignal(GetTree().CreateTimer(1.0), "timeout");
        GD.Print("DEMO // close");
        CloseDetail();
        await ToSignal(GetTree().CreateTimer(2.6), "timeout");
        GD.Print("DEMO COMPLETE");
        GetTree().Quit();
    }

    private void UpdateMetrics(double delta)
    {
        _frameMs = delta * 1000.0;
        _frameTimes.Enqueue(_frameMs);
        while (_frameTimes.Count > 90) _frameTimes.Dequeue();
        double averageMs = _frameTimes.Average();
        _fps = averageMs > 0.001 ? 1000.0 / averageMs : 0;

        double cpuMs = _process.TotalProcessorTime.TotalMilliseconds;
        DateTime now = DateTime.UtcNow;
        double wallMs = (now - _lastCpuStamp).TotalMilliseconds;
        if (wallMs > 30)
        {
            _cpuPercent = Math.Clamp((cpuMs - _lastCpuMs) / wallMs / System.Environment.ProcessorCount * 100.0, 0, 100);
            _lastCpuMs = cpuMs;
            _lastCpuStamp = now;
        }

        _workingSetMb = _process.WorkingSet64 / (1024 * 1024);
        try
        {
            _drawCalls = (int)Performance.GetMonitor(Performance.Monitor.RenderTotalDrawCallsInFrame);
        }
        catch
        {
            _drawCalls = 0;
        }

        if (_uptime > 5.0 && !_benchmark && _frameTimes.Count >= 90 && _fps < 22 && _profileIndex < 3)
        {
            // Soft guidance only. The prototype never silently lowers the profile.
            _hudStatus.Text = "LOW FPS // TRY BALANCED OR COMPATIBILITY  [3] [4]";
        }
    }

    private void UpdateCamera(double delta)
    {
        if (_detailOpen)
        {
            // Keep the console square to the viewer while it is the focus.
            _yawDegrees = Mathf.Lerp(_yawDegrees, 0f, Mathf.Clamp((float)delta * 3.0f, 0f, 1f));
            _pitchDegrees = Mathf.Lerp(_pitchDegrees, -6f, Mathf.Clamp((float)delta * 3.0f, 0f, 1f));
        }
        else if (!_orbiting && _uptime - _lastInteraction > 6.0)
        {
            _yawDegrees += (float)delta * 0.45f;
        }

        _yawDegrees = Mathf.Clamp(_yawDegrees, -38f, 38f);
        _pitchDegrees = Mathf.Clamp(_pitchDegrees, -22f, 10f);
        _cameraRig.Rotation = new Vector3(Mathf.DegToRad(_pitchDegrees), Mathf.DegToRad(_yawDegrees), 0);
        float smooth = Mathf.Clamp((float)delta * 7f, 0, 1);
        _camera.Position = _camera.Position.Lerp(new Vector3(0, 0, _targetDistance), smooth);
    }

    private void ResetCamera()
    {
        _yawDegrees = 0;
        _pitchDegrees = -6f;
        _targetDistance = 13.2f;
        _lastInteraction = _uptime;
    }

    private void ApplyProfile(int index, bool announce)
    {
        index = Math.Clamp(index, 0, _profiles.Length - 1);
        ProfileSpec profile = _profiles[index];
        _profileIndex = index;
        _animationScale = profile.Animation;

        GetViewport().Scaling3DScale = profile.ResolutionScale;
        Engine.MaxFps = profile.TargetFps;

        if (_starParticles != null)
        {
            _starParticles.Amount = profile.Stars;
            _starParticles.Restart();
        }

        if (_motes != null)
        {
            _motes.Amount = profile.Motes;
            _motes.Restart();
        }

        if (_keyLight != null)
        {
            _keyLight.ShadowEnabled = profile.Shadows;
            _keyLight.DirectionalShadowMaxDistance = profile.Shadows ? 65f : 20f;
        }

        if (_rimLight != null) _rimLight.ShadowEnabled = profile.Shadows && index == 0;

        if (_probe != null)
        {
            _probe.UpdateMode = profile.Reflections
                ? ReflectionProbe.UpdateModeEnum.Once
                : ReflectionProbe.UpdateModeEnum.Once;
            _probe.Visible = profile.Reflections;
        }

        if (_accentA != null) _accentA.Visible = profile.Lights >= 2;
        if (_accentB != null) _accentB.Visible = profile.Lights >= 3;
        if (_coreLight != null) _coreLight.ShadowEnabled = profile.Shadows && profile.Lights >= 3;

        if (_environment != null)
        {
            _environment.GlowEnabled = _glowEnabled && profile.Glow;
            _environment.GlowIntensity = index == 0 ? 0.90f : index == 1 ? 0.72f : 0.52f;
            _environment.FogEnabled = index < 2;
        }

        for (int i = 0; i < _orbiters.Count; i++)
        {
            _orbiters[i].Mesh.Visible = index < 2 || i % 2 == 0;
        }

        UpdateProfileButtons();
        if (announce)
        {
            _hudStatus.Text = $"PROFILE // {profile.Name} APPLIED";
            _statusUntil = _uptime + 3.2;
        }
        if (_detailOpen && _section == "settings") RefreshDetail();
    }

    private void UpdateProfileButtons()
    {
        foreach (AstralButton button in _buttons)
        {
            if (!button.Id.StartsWith("profile-", System.StringComparison.Ordinal)) continue;
            if (!int.TryParse(button.Id[8..], out int index)) continue;
            bool selected = index == _profileIndex;
            button.BaseColor = selected ? new Color(0.25f, 0.16f, 0.050f) : new Color(0.018f, 0.023f, 0.037f);
            button.Material.AlbedoColor = button.BaseColor;
            button.Material.Emission = selected ? AthenaVisuals.Gold * 0.30f : AthenaVisuals.Gold * 0.015f;
            button.Material.EmissionEnergyMultiplier = selected ? 1.5f : 0.35f;
            button.Text.Modulate = selected ? AthenaVisuals.PaleGold : new Color(0.70f, 0.64f, 0.51f);
        }
    }

    private void ToggleVsync()
    {
        _vsync = !_vsync;
        DisplayServer.WindowSetVsyncMode(_vsync ? DisplayServer.VSyncMode.Enabled : DisplayServer.VSyncMode.Disabled);
        _hudStatus.Text = "VSYNC // " + (_vsync ? "ON" : "OFF");
        _statusUntil = _uptime + 2.4;
        if (_section == "settings") RefreshDetail();
    }

    private void ToggleFullscreen()
    {
        _fullscreen = !_fullscreen;
        DisplayServer.WindowSetMode(_fullscreen ? DisplayServer.WindowMode.Fullscreen : DisplayServer.WindowMode.Windowed);
        _hudStatus.Text = "DISPLAY // " + (_fullscreen ? "FULLSCREEN" : "WINDOWED");
        _statusUntil = _uptime + 2.4;
        if (_section == "settings") RefreshDetail();
    }

    private void ToggleGlow()
    {
        _glowEnabled = !_glowEnabled;
        ApplyProfile(_profileIndex, false);
        _hudStatus.Text = "GLOW // " + (_glowEnabled ? "ON" : "OFF");
        _statusUntil = _uptime + 2.4;
        if (_section == "settings") RefreshDetail();
    }

    private void UpdateHud(double delta)
    {
        _hudClock += delta;
        if (_hudClock < 0.15) return;
        _hudClock = 0;

        ProfileSpec profile = _profiles[_profileIndex];
        string target = profile.TargetFps == 0 ? "UNCAPPED" : profile.TargetFps + " TARGET";
        _hudStats.Text =
            $"LIVE ENGINE\nFPS {_fps,6:0.0}   FRAME {_frameMs,5:0.0} ms\n" +
            $"APP CPU {_cpuPercent,4:0.0}%   MEM {_workingSetMb,4} MB\n" +
            $"DRAW {_drawCalls,4}   {profile.Name} // {target}";
        _hudMode.Text = $"{profile.Name}  //  {Mathf.RoundToInt(profile.ResolutionScale * 100)}% 3D SCALE";

        if (_uptime > _statusUntil && string.IsNullOrEmpty(_section))
            _hudStatus.Text = "SELECT A FLOATING PANEL  //  SYSTEM  NODE  SETTINGS";
        _hudStatus.Modulate = new Color(1, 0.82f, 0.48f, _uptime > _statusUntil ? 0.65f : 1f);

        if (_detailOpen) UpdateDetailLive();
    }

    private void BeginBenchmark()
    {
        _vsync = false;
        DisplayServer.WindowSetVsyncMode(DisplayServer.VSyncMode.Disabled);
        _benchProfile = 0;
        _benchElapsed = 0;
        _benchmarkFrames.Clear();
        _benchMemoryPeak = 0;
        _benchDrawTotal = 0;
        _benchDrawSamples = 0;
        _benchmarkLines.Clear();
        _benchmarkLines.Add("profile,fps_avg,fps_1pct_low,frame_ms_avg,frame_ms_max,cpu_percent,working_set_peak_mb,draw_calls_avg");
        ApplyProfile(0, false);
        _hudStatus.Text = "BENCHMARK // ULTRA";
    }

    private void UpdateBenchmark(double delta)
    {
        if (!_benchmark || _benchProfile < 0 || _benchProfile >= _profiles.Length) return;
        _benchElapsed += delta;

        if (_benchElapsed > 2.5)
        {
            _benchmarkFrames.Add(delta * 1000.0);
            _benchMemoryPeak = Math.Max(_benchMemoryPeak, _workingSetMb);
            _benchDrawTotal += _drawCalls;
            _benchDrawSamples++;
        }

        if (_benchElapsed < 10.0) return;

        List<double> frames = _benchmarkFrames.OrderBy(v => v).ToList();
        double average = frames.Count > 0 ? frames.Average() : 0;
        double max = frames.Count > 0 ? frames[^1] : 0;
        double p99 = frames.Count > 0 ? frames[Math.Min(frames.Count - 1, (int)(frames.Count * 0.99))] : 0;
        double fpsAverage = average > 0 ? 1000.0 / average : 0;
        double fpsLow = p99 > 0 ? 1000.0 / p99 : 0;
        int drawAverage = _benchDrawSamples > 0 ? (int)(_benchDrawTotal / _benchDrawSamples) : 0;

        string row = string.Join(",", new[]
        {
            _profiles[_benchProfile].Name,
            fpsAverage.ToString("0.0", CultureInfo.InvariantCulture),
            fpsLow.ToString("0.0", CultureInfo.InvariantCulture),
            average.ToString("0.00", CultureInfo.InvariantCulture),
            max.ToString("0.00", CultureInfo.InvariantCulture),
            _cpuPercent.ToString("0.0", CultureInfo.InvariantCulture),
            _benchMemoryPeak.ToString(CultureInfo.InvariantCulture),
            drawAverage.ToString(CultureInfo.InvariantCulture),
        });
        _benchmarkLines.Add(row);
        GD.Print("BENCH " + row);

        _benchProfile++;
        if (_benchProfile >= _profiles.Length)
        {
            string path = ProjectSettings.GlobalizePath(_benchmarkPath);
            try
            {
                string? directory = Path.GetDirectoryName(path);
                if (!string.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);
                File.WriteAllText(path, string.Join("\n", _benchmarkLines) + "\n");
                GD.Print("BENCHMARK COMPLETE " + path);
            }
            catch (Exception error)
            {
                GD.PushError("Benchmark write failed: " + error.Message);
            }
            _benchmark = false;
            GetTree().Quit();
            return;
        }

        _benchElapsed = 0;
        _benchmarkFrames.Clear();
        _benchMemoryPeak = 0;
        _benchDrawTotal = 0;
        _benchDrawSamples = 0;
        ApplyProfile(_benchProfile, false);
        _hudStatus.Text = "BENCHMARK // " + _profiles[_benchProfile].Name;
    }

    private async System.Threading.Tasks.Task CaptureSequence(string directory)
    {
        try
        {
            Directory.CreateDirectory(directory);
        }
        catch (Exception error)
        {
            GD.PushError("Could not create screenshot directory: " + error.Message);
            GetTree().Quit();
            return;
        }

        await ToSignal(GetTree().CreateTimer(2.8), "timeout");
        await CaptureFrame(Path.Combine(directory, "01-command.jpg"));

        OpenSection("system");
        await ToSignal(GetTree().CreateTimer(1.3), "timeout");
        await CaptureFrame(Path.Combine(directory, "02-system.jpg"));

        OpenSection("node");
        await ToSignal(GetTree().CreateTimer(1.1), "timeout");
        await CaptureFrame(Path.Combine(directory, "03-node.jpg"));

        OpenSection("settings");
        await ToSignal(GetTree().CreateTimer(1.1), "timeout");
        await CaptureFrame(Path.Combine(directory, "04-settings.jpg"));

        ApplyProfile(3, true);
        await ToSignal(GetTree().CreateTimer(2.6), "timeout");
        await CaptureFrame(Path.Combine(directory, "05-compatibility.jpg"));

        GD.Print("CAPTURE COMPLETE " + directory);
        GetTree().Quit();
    }

    private async System.Threading.Tasks.Task CaptureFrame(string path)
    {
        await ToSignal(RenderingServer.Singleton, "frame_post_draw");
        Image image = GetViewport().GetTexture().GetImage();
        if (image == null)
        {
            GD.PushError("Screenshot capture returned no image.");
            return;
        }

        // Keep the committed assets small. The viewport is 1440x900.
        image.Resize(1280, 800, Image.Interpolation.Lanczos);
        Error error = image.SaveJpg(path, 0.88f);
        GD.Print(error == Error.Ok ? "CAPTURE " + path : "CAPTURE FAILED " + error);
    }

    private void QuitPrototype()
    {
        if (_quitting) return;
        _quitting = true;
        GetTree().Quit();
    }
}
