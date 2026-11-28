using Godot;
using System;
using System.Collections.Generic;

namespace AthenaDesktop;

/// <summary>
/// The command interface is real 3D geometry living in the astral chamber.
/// Panels are not HTML, textures or a web overlay: they are meshes, lights,
/// labels and physics colliders.
/// </summary>
public partial class Main
{
    private const uint ButtonLayer = 2;

    private void BuildInterface()
    {
        BuildCommandPanels();
        BuildProfileDock();
        BuildDetailPanel();
        BuildHud();
    }

    private void BuildCommandPanels()
    {
        _commandRoot = new Node3D { Name = "CommandPanels", Position = new Vector3(0, 2.42f, 0) };
        AddChild(_commandRoot);
        _commandBaseY = _commandRoot.Position.Y;

        Node3D system = BuildPanel(_commandRoot, "SystemPanel",
            new Vector3(-4.55f, 0.02f, 2.15f), new Vector2(2.85f, 2.05f),
            new Vector3(0, Mathf.DegToRad(11), 0), "SYSTEM", "VESSEL & CORE");
        AddCommandButton(system, "nav-system", "ENTER SYSTEM", new Vector3(0, -0.73f, 0.12f),
            new Vector2(2.1f, 0.34f));

        Node3D node = BuildPanel(_commandRoot, "NodePanel",
            new Vector3(4.55f, 0.02f, 2.15f), new Vector2(2.85f, 2.05f),
            new Vector3(0, Mathf.DegToRad(-11), 0), "NODE", "DISTRIBUTED LATTICE");
        AddCommandButton(node, "nav-node", "ENTER NODE", new Vector3(0, -0.73f, 0.12f),
            new Vector2(2.1f, 0.34f));

        Node3D settings = BuildPanel(_commandRoot, "SettingsPanel",
            new Vector3(0, -1.72f, 3.55f), new Vector2(3.9f, 1.38f),
            Vector3.Zero, "SETTINGS", "RENDER PROFILE & DISPLAY");
        AddCommandButton(settings, "nav-settings", "OPEN SETTINGS", new Vector3(0, -0.36f, 0.12f),
            new Vector2(2.3f, 0.34f));

        AddPanelNote(system, "CORE NOMINAL\nORBITAL RINGS  05", -0.05f);
        AddPanelNote(node, "HUB NOT ATTACHED\nPROTOTYPE LATTICE", -0.05f);

    }

    private void AddPanelNote(Node3D panel, string text, float y)
    {
        Label3D note = MakeLabel(panel, text, new Vector3(-1.16f, y, 0.075f), 22f,
            new Color(0.55f, 0.53f, 0.46f), HorizontalAlignment.Left);
        note.Name = "PanelNote";
        note.VerticalAlignment = VerticalAlignment.Top;
    }

    private Node3D BuildPanel(Node3D parent, string name, Vector3 position, Vector2 size,
        Vector3 rotation, string title, string subtitle)
    {
        Node3D root = new() { Name = name, Position = position, Rotation = rotation };
        parent.AddChild(root);

        StandardMaterial3D glass = new()
        {
            AlbedoColor = new Color(0.010f, 0.014f, 0.026f),
            Metallic = 0.55f,
            Roughness = 0.28f,
            EmissionEnabled = true,
            Emission = new Color(0.035f, 0.028f, 0.018f),
            EmissionEnergyMultiplier = 0.5f,
        };
        BoxMesh back = new() { Size = new Vector3(size.X, size.Y, 0.075f) };
        MeshInstance3D slab = AthenaVisuals.Mesh(root, back, glass, Vector3.Zero, Vector3.Zero, "PanelGlass");
        slab.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;

        StandardMaterial3D trim = AthenaVisuals.SolidEmissive(AthenaVisuals.Gold, 0.8f);
        float halfW = size.X * 0.5f;
        float halfH = size.Y * 0.5f;
        BoxMesh horizontal = new() { Size = new Vector3(size.X, 0.012f, 0.018f) };
        BoxMesh vertical = new() { Size = new Vector3(0.012f, size.Y, 0.018f) };

        AthenaVisuals.Mesh(root, horizontal, trim, new Vector3(0, halfH, 0.045f), Vector3.Zero, "TopTrim");
        AthenaVisuals.Mesh(root, horizontal, trim, new Vector3(0, -halfH, 0.045f), Vector3.Zero, "BottomTrim");
        AthenaVisuals.Mesh(root, vertical, trim, new Vector3(-halfW, 0, 0.045f), Vector3.Zero, "LeftTrim");
        AthenaVisuals.Mesh(root, vertical, trim, new Vector3(halfW, 0, 0.045f), Vector3.Zero, "RightTrim");

        // A brighter accent rail at the top and fine inner rules.
        BoxMesh accent = new() { Size = new Vector3(size.X * 0.44f, 0.032f, 0.025f) };
        MeshInstance3D accentLine = AthenaVisuals.Mesh(root, accent,
            AthenaVisuals.Shader(AthenaVisuals.ChromaticShader),
            new Vector3(-halfW + size.X * 0.25f, halfH - 0.03f, 0.055f), Vector3.Zero, "AccentRail");
        accentLine.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;

        Label3D titleLabel = MakeLabel(root, title, new Vector3(-halfW + 0.20f, halfH - 0.30f, 0.075f),
            62f, AthenaVisuals.PaleGold, HorizontalAlignment.Left);
        titleLabel.Name = "PanelTitle";

        Label3D subtitleLabel = MakeLabel(root, subtitle,
            new Vector3(-halfW + 0.21f, halfH - 0.55f, 0.075f), 26f,
            new Color(0.70f, 0.65f, 0.52f), HorizontalAlignment.Left);
        subtitleLabel.Name = "PanelSubtitle";

        return root;
    }

    private void BuildProfileDock()
    {
        // Profiles live inside the settings console and on keys 1-4. Keeping the
        // command chamber clear makes the celestial core the focal point.
        _profileRoot = new Node3D { Name = "ProfileDock", Position = new Vector3(0, 1.2f, 7.8f) };
        AddChild(_profileRoot);
        _profileBaseY = _profileRoot.Position.Y;
    }

    private void BuildDetailPanel()
    {
        _detailClosedPosition = new Vector3(0, 2.42f, 9.6f);
        _detailOpenPosition = new Vector3(0, 2.42f, 6.0f);
        _detailBaseY = 2.42f;
        _detailRoot = new Node3D { Name = "DetailPanel", Position = _detailClosedPosition, Visible = false };
        AddChild(_detailRoot);

        Vector2 size = new(7.3f, 4.62f);
        float halfW = size.X * 0.5f;
        float halfH = size.Y * 0.5f;

        StandardMaterial3D glass = new()
        {
            AlbedoColor = new Color(0.008f, 0.012f, 0.023f),
            Metallic = 0.45f,
            Roughness = 0.32f,
            EmissionEnabled = true,
            Emission = new Color(0.025f, 0.021f, 0.014f),
            EmissionEnergyMultiplier = 0.5f,
        };
        BoxMesh back = new() { Size = new Vector3(size.X, size.Y, 0.09f) };
        MeshInstance3D slab = AthenaVisuals.Mesh(_detailRoot, back, glass, Vector3.Zero, Vector3.Zero, "DetailGlass");
        slab.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;

        StandardMaterial3D trim = AthenaVisuals.SolidEmissive(AthenaVisuals.Gold, 0.9f);
        BoxMesh horizontal = new() { Size = new Vector3(size.X, 0.014f, 0.022f) };
        BoxMesh vertical = new() { Size = new Vector3(0.014f, size.Y, 0.022f) };
        AthenaVisuals.Mesh(_detailRoot, horizontal, trim, new Vector3(0, halfH, 0.052f), Vector3.Zero, "DetailTop");
        AthenaVisuals.Mesh(_detailRoot, horizontal, trim, new Vector3(0, -halfH, 0.052f), Vector3.Zero, "DetailBottom");
        AthenaVisuals.Mesh(_detailRoot, vertical, trim, new Vector3(-halfW, 0, 0.052f), Vector3.Zero, "DetailLeft");
        AthenaVisuals.Mesh(_detailRoot, vertical, trim, new Vector3(halfW, 0, 0.052f), Vector3.Zero, "DetailRight");

        BoxMesh accent = new() { Size = new Vector3(2.8f, 0.04f, 0.03f) };
        AthenaVisuals.Mesh(_detailRoot, accent, AthenaVisuals.Shader(AthenaVisuals.ChromaticShader),
            new Vector3(-halfW + 1.4f, halfH - 0.035f, 0.06f), Vector3.Zero, "DetailAccent");

        _detailTitle = MakeLabel(_detailRoot, "SYSTEM", new Vector3(-halfW + 0.34f, halfH - 0.36f, 0.08f),
            78f, AthenaVisuals.PaleGold, HorizontalAlignment.Left);
        _detailTitle.Name = "DetailTitle";

        _detailSub = MakeLabel(_detailRoot, "VESSEL & CORE", new Vector3(-halfW + 0.36f, halfH - 0.65f, 0.08f),
            28f, new Color(0.70f, 0.65f, 0.52f), HorizontalAlignment.Left);
        _detailSub.Name = "DetailSub";

        _detailBanner = MakeLabel(_detailRoot, "PROTOTYPE DATA", new Vector3(0, halfH - 0.94f, 0.08f),
            30f, new Color(1f, 0.67f, 0.28f), HorizontalAlignment.Center);
        _detailBanner.Name = "DetailBanner";

        _detailBody = MakeLabel(_detailRoot, "", new Vector3(-halfW + 0.36f, 1.02f, 0.08f),
            26f, new Color(0.90f, 0.88f, 0.81f), HorizontalAlignment.Left);
        _detailBody.Name = "DetailBody";
        _detailBody.Font = _monoFont;
        _detailBody.VerticalAlignment = VerticalAlignment.Top;
        _detailBody.AutowrapMode = TextServer.AutowrapMode.WordSmart;
        _detailBody.Width = 900f;

        _detailButtonRoot = new Node3D { Name = "DetailButtons", Position = new Vector3(0, -1.64f, 0.10f) };
        _detailRoot.AddChild(_detailButtonRoot);

        _closeButton = CreateButton(_detailRoot, "close", "CLOSE [ESC]",
            new Vector3(halfW - 1.02f, halfH - 0.39f, 0.10f), new Vector2(1.45f, 0.30f), false);
    }

    private void BuildHud()
    {
        _hud = new CanvasLayer { Name = "HUD", Layer = 10 };
        AddChild(_hud);

        Control root = new() { MouseFilter = Control.MouseFilterEnum.Ignore };
        root.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        _hud.AddChild(root);

        ColorRect topLine = new()
        {
            Color = new Color(0.92f, 0.72f, 0.35f, 0.38f),
            MouseFilter = Control.MouseFilterEnum.Ignore,
            Position = new Vector2(34, 112),
            Size = new Vector2(1372, 1),
        };
        root.AddChild(topLine);

        Label title = MakeHudLabel(root, "ATHENA", 44, AthenaVisuals.PaleGold, _displayFont);
        title.Position = new Vector2(34, 12);
        title.Size = new Vector2(500, 52);

        Label subtitle = MakeHudLabel(root, "ASTRAL COMMAND  //  NATIVE 3D PROTOTYPE", 13,
            new Color(0.70f, 0.63f, 0.47f), _monoFont);
        subtitle.Position = new Vector2(36, 58);
        subtitle.Size = new Vector2(620, 22);

        Label native = MakeHudLabel(root, "NO WEBVIEW2  //  REAL-TIME 3D", 12,
            new Color(0.93f, 0.73f, 0.36f, 0.9f), _monoFont);
        native.Position = new Vector2(36, 82);
        native.Size = new Vector2(480, 20);

        _hudMode = MakeHudLabel(root, "BALANCED", 16, AthenaVisuals.PaleGold, _monoFont);
        _hudMode.HorizontalAlignment = HorizontalAlignment.Right;
        _hudMode.Position = new Vector2(930, 22);
        _hudMode.Size = new Vector2(476, 24);

        _hudStats = MakeHudLabel(root, "", 15, new Color(0.82f, 0.81f, 0.73f), _monoFont);
        _hudStats.HorizontalAlignment = HorizontalAlignment.Right;
        _hudStats.Position = new Vector2(920, 74);
        _hudStats.Size = new Vector2(486, 110);

        _hudStatus = MakeHudLabel(root, "SELECT A FLOATING PANEL  //  SYSTEM  NODE  SETTINGS", 16,
            new Color(1f, 0.82f, 0.48f), _monoFont);
        _hudStatus.HorizontalAlignment = HorizontalAlignment.Center;
        _hudStatus.Position = new Vector2(0, 820);
        _hudStatus.Size = new Vector2(1440, 24);

        _hudBridge = MakeHudLabel(root, "SOURCE // IN-ENGINE PROTOTYPE", 11,
            new Color(0.56f, 0.53f, 0.46f), _monoFont);
        _hudBridge.HorizontalAlignment = HorizontalAlignment.Right;
        _hudBridge.Position = new Vector2(930, 856);
        _hudBridge.Size = new Vector2(476, 20);

        Label hint = MakeHudLabel(root, "DRAG / SCROLL TO NAVIGATE   1-4 PROFILE   ESC RETURN", 11,
            new Color(0.48f, 0.46f, 0.41f), _monoFont);
        hint.Position = new Vector2(34, 856);
        hint.Size = new Vector2(700, 20);
    }

    private Label MakeHudLabel(Node parent, string text, int size, Color color, Font font)
    {
        Label label = new()
        {
            Text = text,
            MouseFilter = Control.MouseFilterEnum.Ignore,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        label.AddThemeFontOverride("font", font);
        label.AddThemeFontSizeOverride("font_size", size);
        label.AddThemeColorOverride("font_color", color);
        parent.AddChild(label);
        return label;
    }

    private Label3D MakeLabel(Node parent, string text, Vector3 position, float size, Color color,
        HorizontalAlignment alignment)
    {
        Label3D label = AthenaVisuals.Label(parent, text, position, size, 0.0048f, color, alignment);
        label.Font = _displayFont;
        return label;
    }

    private AstralButton AddCommandButton(Node3D parent, string id, string text, Vector3 position, Vector2 size)
    {
        return CreateButton(parent, id, text, position, size, false);
    }

    private AstralButton CreateButton(Node parent, string id, string text, Vector3 position, Vector2 size,
        bool isProfile)
    {
        StaticBody3D body = new()
        {
            Name = "Button_" + id,
            Position = position,
            CollisionLayer = ButtonLayer,
            CollisionMask = 0,
        };
        parent.AddChild(body);

        CollisionShape3D collision = new() { Shape = new BoxShape3D { Size = new Vector3(size.X, size.Y, 0.16f) } };
        body.AddChild(collision);

        StandardMaterial3D material = new()
        {
            AlbedoColor = new Color(0.020f, 0.028f, 0.047f),
            Metallic = 0.60f,
            Roughness = 0.30f,
            EmissionEnabled = true,
            Emission = AthenaVisuals.Gold * 0.03f,
            EmissionEnergyMultiplier = 1f,
        };

        BoxMesh faceMesh = new() { Size = new Vector3(size.X, size.Y, 0.045f) };
        MeshInstance3D face = AthenaVisuals.Mesh(body, faceMesh, material, new Vector3(0, 0, 0.045f),
            Vector3.Zero, "ButtonFace");
        face.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;

        BoxMesh accentMesh = new() { Size = new Vector3(0.022f, size.Y * 0.62f, 0.014f) };
        MeshInstance3D accent = AthenaVisuals.Mesh(body, accentMesh,
            AthenaVisuals.SolidEmissive(AthenaVisuals.Gold, 1.0f),
            new Vector3(-size.X * 0.5f + 0.018f, 0, 0.072f), Vector3.Zero, "ButtonAccent");
        accent.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;

        Label3D label = MakeLabel(body, text, new Vector3(0, 0, 0.075f), 26f,
            AthenaVisuals.PaleGold, HorizontalAlignment.Center);
        label.Name = "ButtonLabel";

        AstralButton button = new()
        {
            Id = id,
            Body = body,
            Face = face,
            Accent = accent,
            Text = label,
            Material = material,
            BaseColor = material.AlbedoColor,
            IsProfile = isProfile,
        };

        _buttons.Add(button);
        _buttonByBody[body.GetInstanceId()] = button;
        return button;
    }

    private void OnButtonActivated(AstralButton button)
    {
        if (!button.Enabled) return;
        if (button.Id.StartsWith("nav-", StringComparison.Ordinal))
        {
            OpenSection(button.Id[4..]);
            return;
        }

        if (button.Id.StartsWith("profile-", StringComparison.Ordinal)
            && int.TryParse(button.Id[8..], out int profile))
        {
            ApplyProfile(profile, true);
            return;
        }

        switch (button.Id)
        {
            case "close":
                CloseDetail();
                break;
            case "goto-system":
                OpenSection("system");
                break;
            case "goto-node":
                OpenSection("node");
                break;
            case "goto-settings":
                OpenSection("settings");
                break;
            case "toggle-vsync":
                ToggleVsync();
                break;
            case "toggle-fullscreen":
                ToggleFullscreen();
                break;
            case "toggle-glow":
                ToggleGlow();
                break;
            case "recenter":
                ResetCamera();
                _hudStatus.Text = "CAMERA RECENTERED";
                _statusUntil = _uptime + 2.2;
                break;
        }
    }
}
