import { readJson, writeJson, id as newId, nowIso } from "./store.mjs";

/**
 * The executor queue. Tools and the AI both hand work here; one job runs at a
 * time per node so a GPU never gets two conflicting commands at once.
 */

export class Jobs {
  constructor(file, registry) {
    this.file = file;
    this.registry = registry;
    const saved = readJson(file, { jobs: [] });
    this.jobs = Array.isArray(saved.jobs) ? saved.jobs : [];
    this.busy = new Set();
    this.listeners = new Set();
    this.tick = null;
  }

  save() {
    writeJson(this.file, { jobs: this.jobs.slice(0, 200) });
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(job) {
    for (const fn of this.listeners) {
      try {
        fn(job);
      } catch {
        /* listener is best effort */
      }
    }
  }

  list(limit = 40) {
    return this.jobs.slice(0, limit);
  }

  get(id) {
    return this.jobs.find((job) => job.id === id) || null;
  }

  create({ node, op, args = {}, label }) {
    const job = {
      id: newId("job"),
      node,
      op,
      args,
      label: label || `${op} on ${node}`,
      state: "queued",
      createdAt: nowIso(),
      startedAt: null,
      endedAt: null,
      output: "",
      source: args.source || "api",
    };
    this.jobs.unshift(job);
    this.save();
    this.emit(job);
    this.pump();
    return job;
  }

  /**
   * A hub restart must not leave work in limbo forever. Anything that was
   * running is marked failed (the process that owned it is gone), queued work
   * stays queued and is pumped again below.
   */
  recover() {
    let failed = 0;
    for (const job of this.jobs) {
      if (job.state === "running") {
        job.state = "failed";
        job.endedAt = nowIso();
        job.error = "Hub restarted before this job finished.";
        job.output = `${job.output || ""}\n[athena] Hub restarted before this job finished.`.trim();
        failed += 1;
      }
    }
    if (failed) this.save();
    this.pump();
    return { failed };
  }

  /**
   * Queued work is dropped from the queue; running work is cancelled on the
   * node itself and marked cancelled here so the result cannot overwrite it.
   */
  async cancel(id) {
    const job = this.get(id);
    if (!job) return false;
    if (job.state === "queued") {
      job.state = "cancelled";
      job.endedAt = nowIso();
      this.save();
      this.emit(job);
      return true;
    }
    if (job.state === "running") {
      job.cancelRequested = true;
      job.state = "cancelled";
      job.endedAt = nowIso();
      this.save();
      this.emit(job);
      try {
        await this.registry.cancelTask?.(job.node);
      } catch {
        /* the task may already have finished */
      }
      return true;
    }
    return false;
  }

  async pump() {
    if (this.tick) return;
    this.tick = setTimeout(() => {
      this.tick = null;
      void this.drain();
    }, 120);
  }

  async drain() {
    for (const job of this.jobs.filter((item) => item.state === "queued")) {
      if (this.busy.has(job.node)) continue;
      this.busy.add(job.node);
      void this.execute(job).finally(() => {
        this.busy.delete(job.node);
        this.pump();
      });
    }
  }

  async execute(job) {
    if (job.cancelRequested || job.state === "cancelled") return;
    job.state = "running";
    job.startedAt = nowIso();
    this.save();
    this.emit(job);
    try {
      if (job.op === "run" || job.op === "exec") {
        const task = await this.registry.run(job.node, job.args.command, {
          timeoutSec: Number(job.args.timeoutSec) || 900,
          cwd: job.args.cwd,
        });
        job.output = String(task.output || "").slice(0, 60_000);
        job.state = task.state === "done" ? "done" : task.state === "failed" ? "failed" : task.state || "done";
        job.code = task.code ?? null;
      } else {
        const result = await this.registry.action(job.node, job.op, job.args);
        job.output = JSON.stringify(result, null, 2).slice(0, 60_000);
        job.state = "done";
      }
    } catch (error) {
      job.output = String(error?.message || error);
      job.state = "failed";
    }
    if (job.cancelRequested) {
      job.state = "cancelled";
      job.output = `${job.output || ""}\n[athena] Cancelled.`.trim();
    }
    job.endedAt = job.endedAt || nowIso();
    this.save();
    this.emit(job);
  }
}
