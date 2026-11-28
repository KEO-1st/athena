using Godot;

namespace AthenaDesktop;

public partial class Main
{
    private void BuildEnvironment()
    {
        _environment = new Godot.Environment
        {
            BackgroundMode = Godot.Environment.BGMode.Color,
            BackgroundColor = new Color(0.001f, 0.003f, 0.010f),
            AmbientLightSource = Godot.Environment.AmbientSource.Color,
            AmbientLightColor = new Color(0.10f, 0.13f, 0.22f),
            AmbientLightEnergy = 0.26f,
            TonemapMode = Godot.Environment.ToneMapper.Filmic,
            TonemapExposure = 1.0f,
            GlowEnabled = true,
            GlowIntensity = 0.42f,
            GlowStrength = 0.34f,
            GlowBloom = 0.035f,
            GlowHdrThreshold = 1.45f,
            AdjustmentEnabled = true,
            AdjustmentContrast = 1.08f,
            AdjustmentSaturation = 1.16f,
            AdjustmentBrightness = 1.0f,
            FogEnabled = true,
            FogLightColor = new Color(0.008f, 0.012f, 0.024f),
            FogDensity = 0.0004f,
        };

        WorldEnvironment world = new() { Environment = _environment };
        AddChild(world);

        _keyLight = new DirectionalLight3D
        {
            Name = "SolarKey",
            RotationDegrees = new Vector3(-38, 38, -12),
            LightColor = new Color(0.86f, 0.91f, 1.0f),
            LightEnergy = 1.2f,
            ShadowEnabled = true,
            DirectionalShadowMaxDistance = 65f,
        };
        AddChild(_keyLight);

        _rimLight = new DirectionalLight3D
        {
            Name = "GoldRim",
            RotationDegrees = new Vector3(-18, -142, 8),
            LightColor = AthenaVisuals.Gold,
            LightEnergy = 0.42f,
            ShadowEnabled = false,
        };
        AddChild(_rimLight);

        _accentA = new OmniLight3D
        {
            Name = "CyanAccent",
            Position = new Vector3(-6.5f, 5.2f, 2.5f),
            LightColor = AthenaVisuals.Cyan,
            LightEnergy = 1.35f,
            OmniRange = 13f,
            ShadowEnabled = false,
        };
        AddChild(_accentA);

        _accentB = new OmniLight3D
        {
            Name = "AmberAccent",
            Position = new Vector3(6.8f, 0.7f, -2.8f),
            LightColor = AthenaVisuals.Amber,
            LightEnergy = 1.7f,
            OmniRange = 15f,
            ShadowEnabled = false,
        };
        AddChild(_accentB);

        _probe = new ReflectionProbe
        {
            Name = "AstralReflection",
            Position = new Vector3(0, 2.4f, 1.5f),
            Size = new Vector3(28, 18, 28),
            UpdateMode = ReflectionProbe.UpdateModeEnum.Once,
            Intensity = 0.9f,
            MaxDistance = 40f,
            BoxProjection = true,
        };
        AddChild(_probe);
    }

    private void BuildCamera()
    {
        _cameraRig = new Node3D { Name = "CameraRig", Position = new Vector3(0, 2.45f, 0) };
        AddChild(_cameraRig);

        _camera = new Camera3D
        {
            Name = "CommandEye",
            Position = new Vector3(0, 0, 13.2f),
            Fov = 52f,
            Near = 0.05f,
            Far = 260f,
            Current = true,
        };
        _cameraRig.AddChild(_camera);
        _cameraRig.Rotation = new Vector3(Mathf.DegToRad(_pitchDegrees), 0, 0);
    }

    private void BuildAstralEnvironment()
    {
        SphereMesh skyMesh = new()
        {
            Radius = 96f,
            Height = 192f,
            RadialSegments = 64,
            Rings = 32,
        };
        MeshInstance3D sky = AthenaVisuals.Mesh(this, skyMesh,
            AthenaVisuals.Shader(AthenaVisuals.NebulaShader), Vector3.Zero, Vector3.Zero, "AstralVeil");
        sky.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;
        sky.ExtraCullMargin = 8f;

        BuildStarField();
        BuildDistantStars();
        BuildDistantArches();
    }

    private void BuildStarField()
    {
        StandardMaterial3D starMaterial = new()
        {
            AlbedoTexture = _dustTexture,
            AlbedoColor = new Color(1f, 0.87f, 0.62f),
            ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
            Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
            BlendMode = BaseMaterial3D.BlendModeEnum.Add,
            BillboardMode = BaseMaterial3D.BillboardModeEnum.Particles,
            BillboardKeepScale = true,
            VertexColorUseAsAlbedo = true,
            NoDepthTest = false,
            EmissionEnabled = true,
            Emission = new Color(1f, 0.78f, 0.42f),
            EmissionEnergyMultiplier = 1.8f,
        };

        QuadMesh starQuad = new() { Size = new Vector2(0.14f, 0.14f) };

        _starParticles = new GpuParticles3D
        {
            Name = "AstralStarField",
            Position = new Vector3(0, 9f, -6f),
            Amount = 1200,
            Lifetime = 90,
            Preprocess = 90,
            Emitting = true,
            LocalCoords = false,
            VisibilityAabb = new Aabb(new Vector3(-90, -60, -90), new Vector3(180, 120, 180)),
            ProcessMaterial = new ParticleProcessMaterial
            {
                EmissionShape = ParticleProcessMaterial.EmissionShapeEnum.Box,
                EmissionBoxExtents = new Vector3(72, 44, 72),
                Gravity = Vector3.Zero,
                Direction = new Vector3(0, 0, -1),
                Spread = 180f,
                InitialVelocityMin = 0.0f,
                InitialVelocityMax = 0.05f,
                ScaleMin = 0.35f,
                ScaleMax = 1.35f,
                LifetimeRandomness = 0.4f,
                Color = new Color(1f, 0.88f, 0.66f, 0.9f),
            },
            DrawPass1 = starQuad,
        };
        _starParticles.DrawPass1 = starQuad;
        starQuad.Material = starMaterial;
        _starParticles.MaterialOverride = starMaterial;
        AddChild(_starParticles);

        StandardMaterial3D moteMaterial = new()
        {
            AlbedoTexture = _starTexture,
            AlbedoColor = new Color(1f, 0.79f, 0.36f),
            ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
            Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
            BlendMode = BaseMaterial3D.BlendModeEnum.Add,
            BillboardMode = BaseMaterial3D.BillboardModeEnum.Particles,
            VertexColorUseAsAlbedo = true,
            NoDepthTest = false,
            EmissionEnabled = true,
            Emission = new Color(1f, 0.72f, 0.26f),
            EmissionEnergyMultiplier = 2.5f,
        };

        _motes = new GpuParticles3D
        {
            Name = "CoreMotes",
            Position = new Vector3(0, 2.4f, 0),
            Amount = 120,
            Lifetime = 13,
            Preprocess = 13,
            Emitting = true,
            LocalCoords = false,
            VisibilityAabb = new Aabb(new Vector3(-14, -10, -14), new Vector3(28, 24, 28)),
            ProcessMaterial = new ParticleProcessMaterial
            {
                EmissionShape = ParticleProcessMaterial.EmissionShapeEnum.Sphere,
                EmissionSphereRadius = 3.8f,
                Gravity = new Vector3(0, 0.03f, 0),
                Direction = new Vector3(0, 1, 0),
                Spread = 60f,
                InitialVelocityMin = 0.02f,
                InitialVelocityMax = 0.18f,
                ScaleMin = 0.2f,
                ScaleMax = 0.75f,
                Color = new Color(1f, 0.81f, 0.42f, 0.7f),
            },
            DrawPass1 = new QuadMesh { Size = new Vector2(0.11f, 0.11f) },
        };
        ((QuadMesh)_motes.DrawPass1).Material = moteMaterial;
        _motes.MaterialOverride = moteMaterial;
        AddChild(_motes);
    }

    private void BuildDistantStars()
    {
        Vector3[] positions =
        {
            new(-4.8f, 5.7f, -4.5f), new(3.8f, 6.5f, -7.0f), new(7.4f, 4.0f, -8.0f),
            new(-8.2f, 3.2f, -6.0f), new(1.2f, 8.2f, -11.0f), new(-2.5f, 0.7f, -9.0f),
            new(6.1f, 7.2f, -13.0f), new(-6.5f, 7.6f, -12.0f),
        };
        for (int i = 0; i < positions.Length; i++)
        {
            float scale = i % 3 == 0 ? 0.0085f : 0.0048f;
            Sprite3D star = AthenaVisuals.Sprite(this, _starTexture, positions[i], scale,
                new Color(1f, 0.85f + (i % 2) * 0.08f, 0.56f, 0.95f));
            star.Name = "AstralStar" + i;
        }

        Sprite3D crownStar = AthenaVisuals.Sprite(this, _starTexture, new Vector3(0, 4.25f, -1.4f), 0.0105f,
            new Color(1f, 0.92f, 0.7f, 1f));
        crownStar.Name = "CrownStar";

        // Signature four-point stars placed in the near chamber. These are the
        // visual anchor of the ATHENA identity, not a post-processing overlay.
        (Vector3 position, float size, Color tint)[] nearStars =
        {
            (new Vector3(-5.3f, 4.15f, 3.4f), 0.0024f, new Color(1f, 0.95f, 0.82f, 0.95f)),
            (new Vector3(5.1f, 4.35f, 3.1f), 0.0021f, new Color(1f, 0.86f, 0.56f, 0.9f)),
            (new Vector3(-3.0f, 5.05f, 1.2f), 0.0018f, new Color(0.88f, 0.94f, 1f, 0.9f)),
            (new Vector3(2.7f, 4.95f, 1.4f), 0.0016f, new Color(1f, 0.90f, 0.72f, 0.85f)),
            (new Vector3(-7.1f, 1.9f, 2.6f), 0.0019f, new Color(0.82f, 0.92f, 1f, 0.8f)),
            (new Vector3(7.3f, 2.4f, 2.2f), 0.0022f, new Color(1f, 0.82f, 0.50f, 0.85f)),
            (new Vector3(0.8f, 5.6f, 0.2f), 0.0014f, new Color(1f, 0.95f, 0.85f, 0.8f)),
        };

        for (int i = 0; i < nearStars.Length; i++)
        {
            (Vector3 position, float size, Color tint) = nearStars[i];
            Sprite3D star = AthenaVisuals.Sprite(this, _starTexture, position, size, tint);
            star.Name = "SignatureStar" + i;
        }
    }

    private void BuildDistantArches()
    {
        ShaderMaterial faintGold = AthenaVisuals.Shader(AthenaVisuals.IridescentGoldShader);
        faintGold.SetShaderParameter("intensity", 0.18f);
        faintGold.SetShaderParameter("opacity", 0.5f);

        for (int i = 0; i < 3; i++)
        {
            float radius = 13.5f + i * 2.8f;
            MeshInstance3D arch = AthenaVisuals.Mesh(this, AthenaVisuals.Ring(radius, radius + 0.035f, 256),
                faintGold, new Vector3(0, 2.2f, -8f - i * 2f),
                new Vector3(Mathf.DegToRad(72 + i * 7), Mathf.DegToRad(18 - i * 11), Mathf.DegToRad(8)),
                "DistantArch" + i);
            arch.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;
        }
    }
}
