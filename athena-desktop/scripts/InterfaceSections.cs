using Godot;
using System;

namespace AthenaDesktop;

public partial class Main
{
    private void OpenSection(string section)
    {
        section = section switch
        {
            "system" => "system",
            "node" => "node",
            "settings" => "settings",
            _ => "system",
        };

        _section = section;
        _detailOpen = true;
        _detailAnimating = true;
        _detailRoot.Visible = true;
        _detailRoot.Position = _detailClosedPosition;
        _commandRoot.Visible = false;
        _profileRoot.Visible = false;

        RefreshDetail();
        _lastInteraction = _uptime;
        _hudStatus.Text = "PANEL OPEN // " + section.ToUpperInvariant();
        _statusUntil = _uptime + 2.4;
    }

    private void CloseDetail()
    {
        if (!_detailOpen) return;
        _detailOpen = false;
        _detailAnimating = true;
        _section = "";
        _commandRoot.Visible = true;
        _profileRoot.Visible = true;
        _hudStatus.Text = "COMMAND ENVIRONMENT";
        _statusUntil = _uptime + 2.2;
        _lastInteraction = _uptime;
    }

    private void RefreshDetail()
    {
        if (!_detailOpen) return;
        foreach (AstralButton button in _detailButtons)
        {
            _buttonByBody.Remove(button.Body.GetInstanceId());
            _buttons.Remove(button);
            if (_hover == button) _hover = null;
            button.Body.QueueFree();
        }
        _detailButtons.Clear();

        _detailBanner.Text = "";
        _detailBanner.Visible = false;

        switch (_section)
        {
            case "system":
                _detailTitle.Text = "SYSTEM";
                _detailSub.Text = "VESSEL & CORE  //  LIVE ENGINE METRICS";
                AddDetailButton("goto-node", "NODE OVERVIEW", -1.05f, 0f, 1.75f);
                AddDetailButton("goto-settings", "SETTINGS", 0.85f, 0f, 1.45f);
                AddDetailButton("recenter", "RECENTER EYE", 2.62f, 0f, 1.45f);
                UpdateDetailLive();
                break;

            case "node":
                _detailTitle.Text = "NODE";
                _detailSub.Text = "DISTRIBUTED LATTICE  //  READ-ONLY VIEW";
                _detailBanner.Visible = true;
                _detailBanner.Text = _snapshot.IsPrototype
                    ? "PROTOTYPE DATA  —  NOT REAL TELEMETRY"
                    : "BRIDGE SNAPSHOT  —  NOT LIVE TELEMETRY";
                _detailBanner.Modulate = new Color(1f, 0.68f, 0.28f, 1f);
                AddDetailButton("goto-system", "SYSTEM OVERVIEW", -0.85f, 0f, 1.8f);
                AddDetailButton("goto-settings", "SETTINGS", 1.05f, 0f, 1.45f);
                _detailBody.Text =
                    "SIMULATED LATTICE SNAPSHOT\n" +
                    $"HUB LINK        {_snapshot.HubStatus}\n" +
                    $"MACHINES        {_snapshot.Machines}\n" +
                    $"NODE            {_snapshot.NodeName}\n" +
                    $"STATE           {_snapshot.NodeState}\n" +
                    $"NODE CPU        {_snapshot.NodeCpu:0.0}%\n" +
                    $"NODE GPU        {_snapshot.NodeGpu:0.0}%\n" +
                    $"NODE MEMORY     {_snapshot.NodeMemoryGb:0.0} / {_snapshot.NodeMemoryTotalGb:0.0} GB\n" +
                    $"TEMPERATURE     {_snapshot.NodeTemperatureC} C\n" +
                    $"DATA SOURCE     {_snapshot.Source}\n" +
                    "\n" +
                    "No Hub is attached to this prototype. These values\n" +
                    "are a designed placeholder, not machine telemetry.";
                break;

            case "settings":
                _detailTitle.Text = "SETTINGS";
                _detailSub.Text = "RENDER PROFILE & DISPLAY";
                ProfileSpec profile = _profiles[_profileIndex];
                _detailBody.Text =
                    $"ACTIVE PROFILE      {profile.Name}\n" +
                    $"3D RESOLUTION       {Mathf.RoundToInt(profile.ResolutionScale * 100)}%\n" +
                    $"FRAME TARGET        {(profile.TargetFps == 0 ? "UNCAPPED" : profile.TargetFps + " FPS")}\n" +
                    $"STAR PARTICLES      {profile.Stars}\n" +
                    $"CORE MOTES          {profile.Motes}\n" +
                    $"SHADOWS             {(profile.Shadows ? "ON" : "OFF")}\n" +
                    $"REFLECTIONS         {(profile.Reflections ? "ON" : "OFF")}\n" +
                    $"ANIMATION SCALE     {Mathf.RoundToInt(profile.Animation * 100)}%\n" +
                    $"\nDISPLAY   {( _fullscreen ? "FULLSCREEN" : "WINDOWED")}   //   VSYNC {(_vsync ? "ON" : "OFF")}   //   GLOW {(_glowEnabled ? "ON" : "OFF")}\n" +
                    "Profiles change real rendering work. Artistic identity is retained.";

                string[] names = { "ULTRA", "HIGH", "BALANCED", "COMPAT." };
                for (int i = 0; i < names.Length; i++)
                {
                    AddDetailButton("profile-" + i, names[i], -2.28f + i * 1.52f, 0.28f, 1.40f);
                }
                AddDetailButton("toggle-vsync", _vsync ? "VSYNC ON" : "VSYNC OFF", -2.55f, -0.17f, 1.22f);
                AddDetailButton("toggle-fullscreen", _fullscreen ? "EXCLUSIVE" : "FULLSCREEN", -1.18f, -0.17f, 1.32f);
                AddDetailButton("toggle-glow", _glowEnabled ? "GLOW ON" : "GLOW OFF", 0.32f, -0.17f, 1.22f);
                AddDetailButton("recenter", "RECENTER", 1.65f, -0.17f, 1.22f);
                break;
        }

        UpdateProfileButtons();
    }

    private void AddDetailButton(string id, string text, float x, float y, float width)
    {
        AstralButton button = CreateButton(_detailButtonRoot, id, text,
            new Vector3(x, y, 0.02f), new Vector2(width, 0.30f), id.StartsWith("profile-", StringComparison.Ordinal));
        _detailButtons.Add(button);
    }

    private void UpdateDetailLive()
    {
        if (!_detailOpen) return;

        if (_section == "system")
        {
            ProfileSpec profile = _profiles[_profileIndex];
            _detailBody.Text =
                "LIVE ENGINE & PROCESS METRICS\n" +
                $"FPS                 {_fps,7:0.0}\n" +
                $"FRAME TIME          {_frameMs,7:0.0} ms\n" +
                $"APP CPU             {_cpuPercent,7:0.0} %\n" +
                $"WORKING SET         {_workingSetMb,7} MB\n" +
                $"DRAW CALLS          {_drawCalls,7}\n" +
                $"RENDER PROFILE      {profile.Name,7}\n" +
                $"3D SCALE            {Mathf.RoundToInt(profile.ResolutionScale * 100),6} %\n" +
                $"UPTIME              {_uptime,7:0.0} s\n" +
                "\n" +
                "The core, orbital machinery and this interface are\n" +
                "native 3D geometry. No browser or WebView2 is running.\n" +
                $"DATA SOURCE         {_dataSource.Describe()}";
        }
        else if (_section == "settings")
        {
            // Settings text only needs refreshing when a setting changes;
            // Toggle* and ApplyProfile call RefreshDetail explicitly.
        }
    }

    public override void _UnhandledInput(InputEvent @event)
    {
        if (_quitting) return;

        if (@event is InputEventKey key && key.Pressed && !key.Echo)
        {
            switch (key.Keycode)
            {
                case Key.Escape:
                    if (_detailOpen) CloseDetail();
                    return;
                case Key.Key1:
                    ApplyProfile(0, true);
                    return;
                case Key.Key2:
                    ApplyProfile(1, true);
                    return;
                case Key.Key3:
                    ApplyProfile(2, true);
                    return;
                case Key.Key4:
                    ApplyProfile(3, true);
                    return;
                case Key.F11:
                    ToggleFullscreen();
                    return;
                case Key.R:
                    ResetCamera();
                    return;
            }
        }

        if (@event is InputEventMouseButton mouse)
        {
            if (mouse.ButtonIndex == MouseButton.WheelUp && mouse.Pressed)
            {
                _targetDistance = Mathf.Clamp(_targetDistance - 0.7f, 8.4f, 18.0f);
                _lastInteraction = _uptime;
            }
            else if (mouse.ButtonIndex == MouseButton.WheelDown && mouse.Pressed)
            {
                _targetDistance = Mathf.Clamp(_targetDistance + 0.7f, 8.4f, 18.0f);
                _lastInteraction = _uptime;
            }
            else if (mouse.ButtonIndex == MouseButton.Left)
            {
                if (mouse.Pressed)
                {
                    _leftDown = true;
                    _dragged = false;
                    _pressPosition = mouse.Position;
                    _orbiting = _hover == null;
                    _lastInteraction = _uptime;
                }
                else
                {
                    if (_hover != null && !_dragged)
                    {
                        OnButtonActivated(_hover);
                    }
                    _leftDown = false;
                    _orbiting = false;
                }
            }
            else if (mouse.ButtonIndex == MouseButton.Right)
            {
                _rightDown = mouse.Pressed;
                if (mouse.Pressed)
                {
                    _orbiting = true;
                    _lastInteraction = _uptime;
                }
                else if (!_leftDown)
                {
                    _orbiting = false;
                }
            }
            return;
        }

        if (@event is InputEventMouseMotion motion)
        {
            if (_leftDown && motion.Position.DistanceTo(_pressPosition) > 6f)
                _dragged = true;

            if (_orbiting)
            {
                _yawDegrees = Mathf.Clamp(_yawDegrees + motion.Relative.X * 0.16f, -38f, 38f);
                _pitchDegrees = Mathf.Clamp(_pitchDegrees - motion.Relative.Y * 0.10f, -22f, 10f);
                _lastInteraction = _uptime;
            }
        }
    }

    private void UpdateHover()
    {
        Vector2 mouse = GetViewport().GetMousePosition();
        Vector3 from = _camera.ProjectRayOrigin(mouse);
        Vector3 to = from + _camera.ProjectRayNormal(mouse) * 90f;

        PhysicsRayQueryParameters3D query = PhysicsRayQueryParameters3D.Create(from, to, ButtonLayer);
        Godot.Collections.Dictionary hit = GetWorld3D().DirectSpaceState.IntersectRay(query);
        AstralButton? found = null;

        if (hit.Count > 0)
        {
            GodotObject? collider = hit["collider"].AsGodotObject();
            if (collider is StaticBody3D body
                && _buttonByBody.TryGetValue(body.GetInstanceId(), out AstralButton? button)
                && button.Enabled
                && button.Body.IsVisibleInTree())
            {
                found = button;
            }
        }

        if (found == _hover) return;

        if (_hover != null && !_hover.IsProfile)
        {
            _hover.Material.AlbedoColor = _hover.BaseColor;
            _hover.Text.Modulate = AthenaVisuals.PaleGold;
        }

        _hover = found;
        UpdateProfileButtons();
        if (_hover != null)
        {
            _hover.Material.AlbedoColor = _hover.BaseColor.Lerp(new Color(0.13f, 0.09f, 0.035f), 0.6f);
            _hover.Text.Modulate = new Color(1f, 0.95f, 0.78f);
        }

        bool pointing = _hover != null;
        if (pointing != _cursorPointing)
        {
            _cursorPointing = pointing;
            Input.SetDefaultCursorShape(pointing
                ? Input.CursorShape.PointingHand
                : Input.CursorShape.Arrow);
        }
    }
}
