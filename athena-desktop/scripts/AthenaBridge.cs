using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using Godot;

namespace AthenaDesktop;

/// <summary>
/// Read-only integration seam. The desktop prototype never talks to provider
/// APIs or pretends to own Hub state. A future Hub/Node integration writes an
/// atomic JSON snapshot; the interface is deliberately small and optional.
/// </summary>
public interface IAthenaDataSource
{
    AthenaSnapshot Read();
    string Describe();
}

public sealed class AthenaSnapshot
{
    public string Source { get; init; } = "prototype";
    public bool IsPrototype { get; init; } = true;
    public string HubStatus { get; init; } = "not connected";
    public int Machines { get; init; }
    public string NodeName { get; init; } = "AEGIS-07";
    public double NodeCpu { get; init; } = 42;
    public double NodeGpu { get; init; } = 61;
    public double NodeMemoryGb { get; init; } = 9.4;
    public double NodeMemoryTotalGb { get; init; } = 16;
    public int NodeTemperatureC { get; init; } = 58;
    public string NodeState { get; init; } = "demo telemetry";
    public long UpdatedUnix { get; init; }
}

public sealed class PrototypeDataSource : IAthenaDataSource
{
    public AthenaSnapshot Read()
    {
        return new AthenaSnapshot
        {
            Source = "in-engine prototype",
            IsPrototype = true,
            HubStatus = "not connected",
            Machines = 1,
            NodeName = "AEGIS-07",
            NodeCpu = 42.0 + GD.RandRange(-4.0, 4.0),
            NodeGpu = 61.0 + GD.RandRange(-6.0, 6.0),
            NodeMemoryGb = 9.4 + GD.RandRange(-0.3, 0.3),
            NodeMemoryTotalGb = 16,
            NodeTemperatureC = 58 + (int)GD.RandRange(-2, 2),
            NodeState = "demo telemetry",
            UpdatedUnix = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
        };
    }

    public string Describe() => "IN-ENGINE PROTOTYPE / no Hub attached";
}

public sealed class JsonFileDataSource(string path) : IAthenaDataSource
{
    private readonly string _path = path;

    public AthenaSnapshot Read()
    {
        try
        {
            string json = File.ReadAllText(_path);
            BridgeEnvelope? envelope = JsonSerializer.Deserialize<BridgeEnvelope>(json, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            });
            if (envelope == null) throw new InvalidDataException("snapshot was empty");

            return new AthenaSnapshot
            {
                Source = string.IsNullOrWhiteSpace(envelope.Source) ? _path : envelope.Source,
                IsPrototype = envelope.Prototype,
                HubStatus = envelope.Hub?.Status ?? "unknown",
                Machines = Math.Max(0, envelope.Hub?.Machines ?? 0),
                NodeName = envelope.Node?.Name ?? "unnamed node",
                NodeCpu = Math.Clamp(envelope.Node?.CpuPercent ?? 0, 0, 100),
                NodeGpu = Math.Clamp(envelope.Node?.GpuPercent ?? 0, 0, 100),
                NodeMemoryGb = Math.Max(0, envelope.Node?.MemoryGb ?? 0),
                NodeMemoryTotalGb = Math.Max(0, envelope.Node?.MemoryTotalGb ?? 0),
                NodeTemperatureC = envelope.Node?.TemperatureC ?? 0,
                NodeState = envelope.Node?.State ?? "unknown",
                UpdatedUnix = envelope.UpdatedUnix,
            };
        }
        catch (Exception error)
        {
            GD.PushWarning($"ATHENA bridge snapshot could not be read: {error.Message}");
            return new AthenaSnapshot
            {
                Source = "bridge error",
                IsPrototype = true,
                HubStatus = "bridge unavailable",
                NodeState = "unverified",
            };
        }
    }

    public string Describe() => $"FILE BRIDGE / {_path}";
}

public static class AthenaBridge
{
    public static string? SnapshotPath(string[] args)
    {
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i].StartsWith("--state=", StringComparison.Ordinal))
                return args[i]["--state=".Length..];
            if (args[i] == "--state" && i + 1 < args.Length)
                return args[i + 1];
        }

        string env = System.Environment.GetEnvironmentVariable("ATHENA_DESKTOP_STATE") ?? string.Empty;
        if (!string.IsNullOrWhiteSpace(env)) return env;

        string user = ProjectSettings.GlobalizePath("user://bridge.json");
        return File.Exists(user) ? user : null;
    }

    public static IAthenaDataSource Create(string[] args)
    {
        string? path = SnapshotPath(args);
        return path != null && File.Exists(path)
            ? new JsonFileDataSource(path)
            : new PrototypeDataSource();
    }
}

public sealed class BridgeEnvelope
{
    [JsonPropertyName("source")] public string? Source { get; set; }
    [JsonPropertyName("prototype")] public bool Prototype { get; set; } = true;
    [JsonPropertyName("hub")] public BridgeHub? Hub { get; set; }
    [JsonPropertyName("node")] public BridgeNode? Node { get; set; }
    [JsonPropertyName("updatedUnix")] public long UpdatedUnix { get; set; }
}

public sealed class BridgeHub
{
    [JsonPropertyName("status")] public string? Status { get; set; }
    [JsonPropertyName("machines")] public int Machines { get; set; }
}

public sealed class BridgeNode
{
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("cpuPercent")] public double CpuPercent { get; set; }
    [JsonPropertyName("gpuPercent")] public double GpuPercent { get; set; }
    [JsonPropertyName("memoryGb")] public double MemoryGb { get; set; }
    [JsonPropertyName("memoryTotalGb")] public double MemoryTotalGb { get; set; }
    [JsonPropertyName("temperatureC")] public int TemperatureC { get; set; }
    [JsonPropertyName("state")] public string? State { get; set; }
}
