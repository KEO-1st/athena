using Godot;
using System.Collections.Generic;

namespace AthenaDesktop;

/// <summary>
/// The astral station itself: a celestial core, orbital machinery, floating
/// monoliths and a dark mirror platform. All geometry is procedural.
/// </summary>
public partial class Main
{
    private Node3D _coreHalo = null!;
    private Node3D _coreShell = null!;
    private Sprite3D _coreGlow = null!;
    private Sprite3D _coreStar = null!;
    private readonly List<Node3D> _diamonds = new();

    private void BuildCore()
    {
        _core = new Node3D { Name = "CelestialCore", Position = new Vector3(0, 2.55f, 0) };
        AddChild(_core);

        // Outer halo: slow iridescent rings around a black mirror sphere.
        _coreShell = new Node3D { Name = "CoreShell" };
        _core.AddChild(_coreShell);

        ShaderMaterial iridescent = AthenaVisuals.Shader(AthenaVisuals.IridescentGoldShader);
        iridescent.SetShaderParameter("intensity", 1.15f);
        iridescent.SetShaderParameter("facet_power", 7.0f);

        SphereMesh orb = new() { Radius = 0.78f, Height = 1.56f, RadialSegments = 64, Rings = 32 };
        MeshInstance3D darkOrb = AthenaVisuals.Mesh(_coreShell, orb, AthenaVisuals.BlackMetal(0.09f),
            Vector3.Zero, Vector3.Zero, "ObsidianHeart");
        darkOrb.CastShadow = GeometryInstance3D.ShadowCastingSetting.On;

        ShaderMaterial coreMaterial = AthenaVisuals.Shader(AthenaVisuals.CoreShader);
        SphereMesh inner = new() { Radius = 0.86f, Height = 1.72f, RadialSegments = 48, Rings = 24 };
        MeshInstance3D heart = AthenaVisuals.Mesh(_coreShell, inner, coreMaterial,
            Vector3.Zero, Vector3.Zero, "LivingLight");
        heart.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;

        // A belt of thin gold rings that read as engraved astral machinery.
        _coreHalo = new Node3D { Name = "CoreHalo" };
        _core.AddChild(_coreHalo);
        _rings.Add(_coreHalo);

        float[] radii = { 1.12f, 1.34f, 1.62f, 2.05f, 2.55f };
        for (int i = 0; i < radii.Length; i++)
        {
            ShaderMaterial gold = i == 1
                ? AthenaVisuals.Shader(AthenaVisuals.ChromaticShader)
                : AthenaVisuals.Shader(AthenaVisuals.IridescentGoldShader);
            if (i != 1) gold.SetShaderParameter("intensity", 0.75f - i * 0.08f);
            TorusMesh torus = AthenaVisuals.Ring(radii[i], radii[i] + (i == 0 ? 0.02f : 0.011f), 220);
            MeshInstance3D ring = AthenaVisuals.Mesh(_coreHalo, torus, gold,
                Vector3.Zero,
                new Vector3(Mathf.DegToRad(68 + i * 19), Mathf.DegToRad(i * 23), Mathf.DegToRad(i * 31)),
                "AstralRing" + i);
            ring.Rotation = new Vector3(Mathf.DegToRad(68 + i * 19), Mathf.DegToRad(i * 23), Mathf.DegToRad(i * 31));
        }

        // Diamond nodes fixed at orbital stations of the inner ring.
        for (int i = 0; i < 6; i++)
        {
            float angle = i * Mathf.Tau / 6f + 0.2f;
            Node3D pivot = new()
            {
                Name = "DiamondPivot" + i,
                Position = new Vector3(Mathf.Cos(angle) * 2.72f, Mathf.Sin(angle * 2f) * 0.34f,
                    Mathf.Sin(angle) * 2.72f),
            };
            _coreHalo.AddChild(pivot);

            SphereMesh diamondMesh = new()
            {
                Radius = 0.16f,
                Height = 0.46f,
                RadialSegments = 4,
                Rings = 2,
            };
            MeshInstance3D diamond = AthenaVisuals.Mesh(pivot, diamondMesh, AthenaVisuals.Diamond(),
                Vector3.Zero, new Vector3(0, 0.7f, 0.35f), "Diamond" + i);
            diamond.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;
            _diamonds.Add(pivot);
        }

        _coreGlow = AthenaVisuals.Sprite(_core, _glowTexture, Vector3.Zero, 0.011f,
            new Color(1f, 0.68f, 0.28f, 0.20f));
        _coreStar = AthenaVisuals.Sprite(_core, _starTexture, Vector3.Zero, 0.0062f,
            new Color(1f, 0.94f, 0.78f, 0.90f));
        _coreStar.NoDepthTest = false;

        _coreLight = new OmniLight3D
        {
            Name = "CoreRadiance",
            Position = new Vector3(0, 0.1f, 0),
            LightColor = new Color(1f, 0.73f, 0.35f),
            LightEnergy = 2.8f,
            OmniRange = 11f,
            ShadowEnabled = true,
            OmniShadowMode = OmniLight3D.ShadowMode.DualParaboloid,
        };
        _core.AddChild(_coreLight);
    }

    private void BuildMonuments()
    {
        Node3D station = new() { Name = "StationArchitecture" };
        AddChild(station);

        // Mirror platform: a dark disc holding the whole command chamber.
        CylinderMesh platform = new()
        {
            TopRadius = 6.4f,
            BottomRadius = 5.5f,
            Height = 0.28f,
            RadialSegments = 96,
        };
        MeshInstance3D disc = AthenaVisuals.Mesh(station, platform, AthenaVisuals.BlackMetal(0.08f),
            new Vector3(0, -0.46f, 0f), Vector3.Zero, "MirrorPlatform");
        disc.CastShadow = GeometryInstance3D.ShadowCastingSetting.On;

        ShaderMaterial platformGold = AthenaVisuals.Shader(AthenaVisuals.IridescentGoldShader);
        platformGold.SetShaderParameter("intensity", 0.32f);
        TorusMesh platformRing = AthenaVisuals.Ring(5.93f, 6.10f, 220);
        MeshInstance3D ring = AthenaVisuals.Mesh(station, platformRing,
            AthenaVisuals.Shader(AthenaVisuals.ChromaticShader),
            new Vector3(0, -0.30f, 0), Vector3.Zero, "PlatformSigil");
        _rings.Add(ring);

        ShaderMaterial rimGold = AthenaVisuals.Shader(AthenaVisuals.IridescentGoldShader);
        rimGold.SetShaderParameter("intensity", 0.20f);
        MeshInstance3D outerRim = AthenaVisuals.Mesh(station, AthenaVisuals.Ring(7.4f, 7.43f, 256),
            rimGold, new Vector3(0, -0.31f, 0), Vector3.Zero, "OuterRim");
        outerRim.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;
        _rings.Add(outerRim);

        // Monumental slivers flank the core, tall enough to give real scale.
        (Vector3 position, Vector3 size, float tilt)[] monoliths =
        {
            (new Vector3(-7.1f, 2.4f, -3.4f), new Vector3(0.30f, 7.0f, 0.62f), 3f),
            (new Vector3(-6.0f, 1.5f, -5.2f), new Vector3(0.20f, 4.4f, 0.44f), -4f),
            (new Vector3(7.0f, 2.8f, -3.1f), new Vector3(0.32f, 7.8f, 0.58f), -3f),
            (new Vector3(5.8f, 1.1f, -5.6f), new Vector3(0.18f, 3.8f, 0.40f), 5f),
            (new Vector3(-4.9f, 0.2f, -7.4f), new Vector3(0.14f, 2.8f, 0.32f), 8f),
            (new Vector3(4.5f, 0.5f, -8.0f), new Vector3(0.12f, 3.2f, 0.28f), -7f),
        };

        for (int i = 0; i < monoliths.Length; i++)
        {
            (Vector3 position, Vector3 size, float tilt) = monoliths[i];
            Node3D monument = new() { Name = "Monument" + i, Position = position };
            monument.RotationDegrees = new Vector3(0, tilt, 0);
            monument.SetMeta("base_y", position.Y);
            monument.SetMeta("phase", i * 0.9f);
            station.AddChild(monument);

            BoxMesh slab = new() { Size = size };
            MeshInstance3D body = AthenaVisuals.Mesh(monument, slab,
                i % 2 == 0 ? AthenaVisuals.BlackMetal(0.16f) : AthenaVisuals.BlackMetal(0.3f),
                Vector3.Zero, Vector3.Zero, "Sliver");
            body.CastShadow = GeometryInstance3D.ShadowCastingSetting.On;

            float edge = size.X * 0.62f;
            BoxMesh seam = new() { Size = new Vector3(edge, size.Y * 0.86f, size.Z + 0.012f) };
            MeshInstance3D line = AthenaVisuals.Mesh(monument, seam, AthenaVisuals.SolidEmissive(AthenaVisuals.Gold, 1.3f),
                new Vector3(0, 0, 0), Vector3.Zero, "GoldSeam");
            line.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;

            if (i % 2 == 0)
            {
                SphereMesh cap = new() { Radius = 0.10f, Height = 0.34f, RadialSegments = 4, Rings = 2 };
                MeshInstance3D diamond = AthenaVisuals.Mesh(monument, cap, AthenaVisuals.Diamond(),
                    new Vector3(0, size.Y * 0.5f + 0.55f, 0), Vector3.Zero, "CrownDiamond");
                diamond.Rotation = new Vector3(0.4f, 0.2f, 0.5f);
            }

            _monuments.Add(monument);
        }

        // Dust-coloured orbiters circling above the platform.
        (float radius, float height, float speed, float phase, float size)[] orbiters =
        {
            (4.4f, 1.1f, 0.14f, 0.3f, 0.055f),
            (4.7f, 1.75f, 0.11f, 2.1f, 0.040f),
            (5.3f, 0.55f, 0.08f, 4.4f, 0.070f),
            (5.1f, 2.7f, 0.16f, 1.2f, 0.032f),
        };

        for (int i = 0; i < orbiters.Length; i++)
        {
            (float radius, float height, float speed, float phase, float size) = orbiters[i];
            Node3D pivot = new() { Name = "Orbiter" + i };
            station.AddChild(pivot);

            MeshInstance3D body = AthenaVisuals.Mesh(pivot,
                i % 2 == 0 ? AthenaVisuals.Ring(0.34f, 0.37f, 96) : ((Mesh)new SphereMesh { Radius = size, Height = size * 2 }),
                i % 2 == 0 ? AthenaVisuals.SolidEmissive(AthenaVisuals.PaleGold, 1.1f) : AthenaVisuals.Diamond(),
                new Vector3(radius, height, 0), new Vector3(Mathf.DegToRad(76), 0, 0), "OrbiterBody" + i);
            body.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;

            _orbiters.Add(new Orbiter
            {
                Mesh = body,
                Radius = radius,
                Height = height,
                Speed = speed,
                Phase = phase,
            });
        }

        // Two enormous slow halos far behind the station, like planetary rings.
        for (int i = 0; i < 2; i++)
        {
            ShaderMaterial halo = AthenaVisuals.Shader(AthenaVisuals.IridescentGoldShader);
            halo.SetShaderParameter("intensity", 0.13f);
            MeshInstance3D circle = AthenaVisuals.Mesh(station,
                AthenaVisuals.Ring(10.5f + i * 2.3f, 10.56f + i * 2.3f, 300),
                halo, new Vector3(0, 2.0f, -10f - i * 3f),
                new Vector3(Mathf.DegToRad(78), Mathf.DegToRad(i * 17), 0), "PlanetaryHalo" + i);
            circle.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;
            _rings.Add(circle);
        }

        // Constellation glyphs: tiny gold crosses suspended in the chamber.
        for (int i = 0; i < 7; i++)
        {
            float angle = i * Mathf.Tau / 7f + 0.6f;
            Sprite3D glyph = AthenaVisuals.Sprite(station, _starTexture,
                new Vector3(Mathf.Cos(angle) * 8.2f, 3.4f + Mathf.Sin(i * 1.7f) * 1.9f,
                    -4.7f + Mathf.Sin(angle) * 3.2f),
                0.0062f, new Color(1f, 0.77f, 0.38f, 0.6f));
            glyph.Name = "ConstellationGlyph" + i;
        }
    }

    private void UpdateWorld(double delta)
    {
        float dt = (float)delta;

        if (_coreShell != null)
        {
            _coreShell.RotateY(dt * 0.10f * _animationScale);
            _coreShell.RotateZ(dt * 0.035f * _animationScale);
            float pulse = 1f + Mathf.Sin((float)_uptime * 1.15f) * 0.012f * _animationScale;
            _coreShell.Scale = new Vector3(pulse, pulse, pulse);
        }

        if (_coreHalo != null)
        {
            _coreHalo.RotateY(dt * 0.15f * _animationScale);
            _coreHalo.RotateX(dt * 0.045f * _animationScale);
        }

        if (_coreGlow != null)
        {
            float glow = 0.17f + Mathf.Sin((float)_uptime * 1.15f) * 0.030f;
            _coreGlow.Modulate = new Color(1f, 0.72f, 0.30f, glow);
        }

        if (_coreStar != null)
        {
            float scale = 0.0060f + Mathf.Sin((float)_uptime * 0.9f) * 0.0006f;
            _coreStar.PixelSize = scale;
        }

        for (int i = 0; i < _rings.Count; i++)
        {
            Node3D ring = _rings[i];
            if (i == 0) continue;
            ring.RotateY(dt * (0.055f + i * 0.017f) * _animationScale);
        }

        for (int i = 0; i < _diamonds.Count; i++)
        {
            Node3D diamond = _diamonds[i];
            diamond.RotateY(dt * 0.45f * _animationScale);
            diamond.Position = new Vector3(diamond.Position.X,
                Mathf.Sin((float)_uptime * 0.8f + i) * 0.18f, diamond.Position.Z);
        }

        for (int i = 0; i < _orbiters.Count; i++)
        {
            Orbiter orbiter = _orbiters[i];
            orbiter.Phase += dt * orbiter.Speed * _animationScale;
            Vector3 orbit = new(
                Mathf.Cos(orbiter.Phase) * orbiter.Radius,
                orbiter.Height + Mathf.Sin(orbiter.Phase * 1.7f) * 0.14f,
                Mathf.Sin(orbiter.Phase) * orbiter.Radius);
            orbiter.Mesh.Position = orbit;
            orbiter.Mesh.RotateY(dt * 0.4f * _animationScale);
        }

        for (int i = 0; i < _monuments.Count; i++)
        {
            Node3D monument = _monuments[i];
            float baseY = (float)monument.GetMeta("base_y");
            float phase = (float)monument.GetMeta("phase");
            monument.Position = new Vector3(monument.Position.X,
                baseY + Mathf.Sin((float)_uptime * 0.36f + phase) * 0.10f * _animationScale,
                monument.Position.Z);
        }

        // The command and profile layers breathe slightly, so the chamber reads
        // as a living space rather than a static product shot.
        if (_commandRoot != null)
        {
            _commandRoot.Position = new Vector3(0, _commandBaseY +
                Mathf.Sin((float)_uptime * 0.42f) * 0.035f * _animationScale, 0);
        }
        if (_profileRoot != null)
        {
            _profileRoot.Position = new Vector3(0, _profileBaseY +
                Mathf.Sin((float)_uptime * 0.38f + 1.4f) * 0.030f * _animationScale, 0);
        }
        if (_detailAnimating)
        {
            Vector3 target = _detailOpen ? _detailOpenPosition : _detailClosedPosition;
            float smoothing = Mathf.Clamp(dt * 7.5f, 0, 1f);
            _detailRoot.Position = _detailRoot.Position.Lerp(target, smoothing);
            if (_detailRoot.Position.DistanceTo(target) < 0.01f)
            {
                _detailRoot.Position = target;
                _detailAnimating = false;
                if (!_detailOpen) _detailRoot.Visible = false;
            }
        }
    }
}
