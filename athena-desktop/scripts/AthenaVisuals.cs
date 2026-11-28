using Godot;

namespace AthenaDesktop;

/// <summary>
/// Procedural art direction. Every surface is generated in code so the
/// executable has no external texture packs or copyrighted reference assets.
/// </summary>
public static class AthenaVisuals
{
    public static readonly Color Gold = new(1.0f, 0.76f, 0.34f);
    public static readonly Color PaleGold = new(1.0f, 0.91f, 0.68f);
    public static readonly Color Amber = new(0.95f, 0.57f, 0.18f);
    public static readonly Color Ink = new(0.008f, 0.011f, 0.022f);
    public static readonly Color Cyan = new(0.48f, 0.88f, 0.95f);

    public const string IridescentGoldShader = """
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

uniform vec3 gold : source_color = vec3(1.0, 0.72, 0.26);
uniform float intensity = 1.0;
uniform float iridescence = 1.0;
uniform float facet_power = 12.0;

void fragment() {
    float ndv = clamp(dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0);
    float fresnel = pow(1.0 - ndv, 2.35);
    float band = sin((UV.x * 9.0 + UV.y * 6.0 + TIME * 0.07) * 6.28318);
    vec3 rainbow = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.32, 0.66) + ndv * 1.35 + band * 0.32));
    vec3 metal = mix(gold * 0.20, gold * 1.12 + vec3(0.16), ndv);
    vec3 irid = mix(metal, rainbow, 0.42 * iridescence);
    float facet = pow(max(0.0, sin(dot(NORMAL, vec3(7.0, 3.0, 5.0)) * 9.0 + TIME * 0.08)), facet_power);

    ALBEDO = irid * 0.74;
    METALLIC = 0.95;
    ROUGHNESS = 0.13;
    SPECULAR = 1.0;
    EMISSION = (gold * 0.055 + rainbow * 0.035) * intensity
             + gold * fresnel * 0.42 * intensity
             + vec3(1.0, 0.94, 0.80) * facet * 0.22;
}
""";

    public const string CoreShader = """
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

uniform vec3 gold : source_color = vec3(1.0, 0.71, 0.25);
uniform float energy = 1.0;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void fragment() {
    float ndv = clamp(dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0);
    float rim = pow(1.0 - ndv, 2.7);
    vec2 flow = UV * vec2(6.0, 3.0) + vec2(TIME * 0.025, -TIME * 0.017);
    float veins = smoothstep(0.56, 0.92, noise(flow) * noise(flow * 2.4 + 4.0));
    float core = smoothstep(0.82, 1.0, ndv);
    float pulse = 0.72 + 0.28 * sin(TIME * 1.15);

    ALBEDO = vec3(0.004, 0.006, 0.010);
    METALLIC = 0.92;
    ROUGHNESS = 0.06;
    EMISSION = gold * (rim * (0.85 + pulse * 0.35) + veins * 0.30) * energy
             + vec3(0.9, 0.97, 1.0) * core * 0.035 * energy;
}
""";

    public const string NebulaShader = """
shader_type spatial;
render_mode unshaded, cull_front, depth_draw_never, blend_mix;

uniform vec3 ink : source_color = vec3(0.002, 0.004, 0.010);
uniform vec3 gold : source_color = vec3(1.0, 0.68, 0.24);

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

float fbm(vec2 p) {
    float value = 0.0;
    float gain = 0.5;
    for (int i = 0; i < 5; i++) {
        value += noise(p) * gain;
        p = p * 2.03 + vec2(3.1, 1.7);
        gain *= 0.52;
    }
    return value;
}

void fragment() {
    vec2 uv = UV;
    float n = fbm(uv * vec2(5.0, 3.2) + vec2(TIME * 0.0025, 0.0));
    float veil = smoothstep(0.34, 0.88, n);
    float arc = smoothstep(0.16, 0.0, abs(uv.y - 0.52 - sin(uv.x * 5.0) * 0.04));
    vec3 col = ink;
    col += vec3(0.012, 0.012, 0.016) * veil * 0.45;
    col += gold * pow(veil, 4.2) * 0.022;
    col += gold * arc * 0.006;
    ALBEDO = col;
}
""";

    public const string StarShader = """
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled;

uniform vec3 tint : source_color = vec3(1.0, 0.88, 0.62);
uniform float brightness = 1.0;

void vertex() {
    MODELVIEW_MATRIX = VIEW_MATRIX * mat4(
        vec4(INV_VIEW_MATRIX[0].xyz, 0.0),
        vec4(INV_VIEW_MATRIX[1].xyz, 0.0),
        vec4(INV_VIEW_MATRIX[2].xyz, 0.0),
        vec4(MODEL_MATRIX[3].xyz, 1.0));
}

void fragment() {
    vec2 p = UV * 2.0 - 1.0;
    float r = length(p);
    float core = smoothstep(0.18, 0.0, r);
    float halo = smoothstep(0.95, 0.0, r) * 0.13;
    float horizontal = smoothstep(0.055, 0.0, abs(p.y)) * smoothstep(0.98, 0.0, abs(p.x));
    float vertical = smoothstep(0.055, 0.0, abs(p.x)) * smoothstep(0.98, 0.0, abs(p.y));
    float flare = (horizontal + vertical) * 0.42;
    float alpha = core + halo + flare;
    ALBEDO = tint * brightness;
    EMISSION = tint * (1.2 + core * 2.6) * brightness;
    ALPHA = clamp(alpha, 0.0, 1.0);
}
""";

    public const string ChromaticShader = """
shader_type spatial;
render_mode unshaded, cull_disabled, blend_add, depth_draw_never;

uniform float intensity = 0.86;
uniform float speed = 0.035;

void fragment() {
    float t = UV.x * 1.9 + UV.y * 0.7 + TIME * speed;
    vec3 rainbow = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + t));
    rainbow = pow(rainbow, vec3(1.15));
    ALBEDO = rainbow * intensity;
    EMISSION = rainbow * intensity * 0.9;
    ALPHA = 0.58;
}
""";

    public const string GearRingShader = """
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

uniform vec3 gold : source_color = vec3(1.0, 0.72, 0.26);
uniform float opacity = 0.72;

void fragment() {
    float ndv = clamp(dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0);
    float cut = step(0.54, fract(UV.x * 36.0));
    float edge = smoothstep(0.0, 0.16, UV.y) * smoothstep(1.0, 0.84, UV.y);
    ALBEDO = gold * (0.18 + ndv * 0.35);
    METALLIC = 0.9;
    ROUGHNESS = 0.22;
    EMISSION = gold * cut * edge * 0.18;
    ALPHA = opacity * (0.55 + edge * 0.45);
}
""";

    public static ShaderMaterial Shader(string code)
    {
        return new ShaderMaterial { Shader = new Shader { Code = code } };
    }

    public static StandardMaterial3D DarkGlass(float alpha = 0.88f)
    {
        return new StandardMaterial3D
        {
            AlbedoColor = new Color(0.012f, 0.017f, 0.030f, alpha),
            Metallic = 0.55f,
            Roughness = 0.23f,
            Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
            ShadingMode = BaseMaterial3D.ShadingModeEnum.PerPixel,
            CullMode = BaseMaterial3D.CullModeEnum.Back,
            EmissionEnabled = true,
            Emission = new Color(0.05f, 0.035f, 0.018f),
            EmissionEnergyMultiplier = 0.6f,
        };
    }

    public static StandardMaterial3D BlackMetal(float roughness = 0.24f)
    {
        return new StandardMaterial3D
        {
            AlbedoColor = new Color(0.020f, 0.024f, 0.034f),
            Metallic = 1.0f,
            Roughness = roughness,
            MetallicSpecular = 1.0f,
        };
    }

    public static StandardMaterial3D Diamond()
    {
        return new StandardMaterial3D
        {
            AlbedoColor = new Color(0.72f, 0.78f, 0.82f, 0.62f),
            Metallic = 1.0f,
            Roughness = 0.035f,
            MetallicSpecular = 1.0f,
            Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
            EmissionEnabled = true,
            Emission = new Color(0.28f, 0.23f, 0.15f),
            EmissionEnergyMultiplier = 0.5f,
        };
    }

    public static StandardMaterial3D AdditiveTexture(Texture2D texture, Color tint)
    {
        return new StandardMaterial3D
        {
            AlbedoTexture = texture,
            AlbedoColor = tint,
            ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
            Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
            BlendMode = BaseMaterial3D.BlendModeEnum.Add,
            BillboardMode = BaseMaterial3D.BillboardModeEnum.Enabled,
            NoDepthTest = false,
            VertexColorUseAsAlbedo = true,
            EmissionEnabled = true,
            Emission = tint,
            EmissionEnergyMultiplier = 2.2f,
        };
    }

    public static StandardMaterial3D SolidEmissive(Color color, float energy = 1.5f)
    {
        return new StandardMaterial3D
        {
            AlbedoColor = color,
            ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded,
            EmissionEnabled = true,
            Emission = color,
            EmissionEnergyMultiplier = energy,
        };
    }

    public static ImageTexture StarTexture(int size = 128)
    {
        Image image = Image.CreateEmpty(size, size, false, Image.Format.Rgba8);
        float half = size * 0.5f;
        for (int y = 0; y < size; y++)
        {
            for (int x = 0; x < size; x++)
            {
                float dx = (x - half) / half;
                float dy = (y - half) / half;
                float radius = Mathf.Sqrt(dx * dx + dy * dy);
                float core = Mathf.Exp(-radius * 16.0f);
                float horizontal = Mathf.Exp(-Mathf.Abs(dy) * 28.0f) * Mathf.Exp(-Mathf.Abs(dx) * 2.0f);
                float vertical = Mathf.Exp(-Mathf.Abs(dx) * 28.0f) * Mathf.Exp(-Mathf.Abs(dy) * 2.0f);
                float diagonal = Mathf.Exp(-Mathf.Abs(dx - dy) * 38.0f) * Mathf.Exp(-Mathf.Abs(dx) * 5.0f)
                               + Mathf.Exp(-Mathf.Abs(dx + dy) * 38.0f) * Mathf.Exp(-Mathf.Abs(dx) * 5.0f);
                float alpha = Mathf.Clamp(core + (horizontal + vertical) * 0.82f + diagonal * 0.12f, 0, 1);
                Color color = new Color(1f, 0.82f + core * 0.16f, 0.58f + core * 0.38f, alpha);
                image.SetPixel(x, y, color);
            }
        }
        return ImageTexture.CreateFromImage(image);
    }

    public static ImageTexture GlowTexture(int size = 128)
    {
        Image image = Image.CreateEmpty(size, size, false, Image.Format.Rgba8);
        float half = size * 0.5f;
        for (int y = 0; y < size; y++)
        {
            for (int x = 0; x < size; x++)
            {
                float dx = (x - half) / half;
                float dy = (y - half) / half;
                float radius = Mathf.Sqrt(dx * dx + dy * dy);
                float alpha = Mathf.Pow(Mathf.Clamp(1f - radius, 0, 1), 3.2f);
                image.SetPixel(x, y, new Color(1f, 0.78f, 0.42f, alpha));
            }
        }
        return ImageTexture.CreateFromImage(image);
    }

    public static ImageTexture DustTexture(int size = 32)
    {
        Image image = Image.CreateEmpty(size, size, false, Image.Format.Rgba8);
        float half = size * 0.5f;
        for (int y = 0; y < size; y++)
        {
            for (int x = 0; x < size; x++)
            {
                float dx = (x - half) / half;
                float dy = (y - half) / half;
                float alpha = Mathf.Exp(-(dx * dx + dy * dy) * 8f);
                image.SetPixel(x, y, new Color(1f, 0.79f, 0.38f, alpha));
            }
        }
        return ImageTexture.CreateFromImage(image);
    }

    public static MeshInstance3D Mesh(
        Node parent,
        Mesh mesh,
        Material material,
        Vector3 position,
        Vector3 rotation = default,
        string name = "Mesh")
    {
        MeshInstance3D instance = new()
        {
            Name = name,
            Mesh = mesh,
            MaterialOverride = material,
            Position = position,
            Rotation = rotation,
            CastShadow = GeometryInstance3D.ShadowCastingSetting.Off,
        };
        parent.AddChild(instance);
        return instance;
    }

    public static Label3D Label(
        Node parent,
        string text,
        Vector3 position,
        float size = 42f,
        float pixelSize = 0.0036f,
        Color? color = null,
        HorizontalAlignment alignment = HorizontalAlignment.Left,
        string name = "Label")
    {
        Label3D label = new()
        {
            Name = name,
            Text = text,
            FontSize = (int)size,
            PixelSize = pixelSize,
            Position = position,
            Modulate = color ?? PaleGold,
            OutlineModulate = new Color(0.01f, 0.008f, 0.003f, 0.9f),
            OutlineSize = 7,
            HorizontalAlignment = alignment,
            VerticalAlignment = VerticalAlignment.Center,
            NoDepthTest = true,
            DoubleSided = true,
        };
        parent.AddChild(label);
        return label;
    }

    public static Sprite3D Sprite(Node parent, Texture2D texture, Vector3 position, float pixelSize, Color tint)
    {
        Sprite3D sprite = new()
        {
            Texture = texture,
            Position = position,
            PixelSize = pixelSize,
            Modulate = tint,
            Billboard = BaseMaterial3D.BillboardModeEnum.Enabled,
            Shaded = false,
            NoDepthTest = false,
        };
        parent.AddChild(sprite);
        return sprite;
    }

    public static TorusMesh Ring(float inner, float outer, int rings = 128)
    {
        return new TorusMesh
        {
            InnerRadius = inner,
            OuterRadius = outer,
            Rings = rings,
            RingSegments = 18,
        };
    }
}
