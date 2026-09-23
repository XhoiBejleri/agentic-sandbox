import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { loadConfig, ConfigError } from "../src/config.js";
import { RunStore, SEED_RUNS } from "../src/runs.js";

function buildApp(store = new RunStore(SEED_RUNS)) {
  const config = loadConfig({ PORT: "0" });
  return createApp({ config, store });
}

describe("config", () => {
  it("uses defaults", () => {
    const cfg = loadConfig({});
    expect(cfg).toMatchObject({ port: 3000, region: "eu", logLevel: "info", metricsEnabled: false });
  });

  it("requires METRICS_PORT when metrics are enabled", () => {
    expect(() => loadConfig({ METRICS_ENABLED: "true" })).toThrow(ConfigError);
    expect(loadConfig({ METRICS_ENABLED: "true", METRICS_PORT: "9100" }).metricsPort).toBe(9100);
  });

  it("rejects unknown log levels", () => {
    expect(() => loadConfig({ LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/);
  });
});

describe("runs api", () => {
  let app: ReturnType<typeof buildApp>;
  beforeEach(() => {
    app = buildApp();
  });

  it("reports health", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", region: "eu" });
  });

  it("lists seeded runs and filters by vehicle", async () => {
    const all = await request(app).get("/api/runs");
    expect(all.body).toHaveLength(SEED_RUNS.length);
    const one = await request(app).get("/api/runs?vehicleId=WVW-1001");
    expect(one.body).toHaveLength(2);
  });

  it("returns 404 for unknown run", async () => {
    const res = await request(app).get("/api/runs/run-9999");
    expect(res.status).toBe(404);
  });

  it("deletes an existing run", async () => {
    const deleted = await request(app).delete("/api/runs/run-0001");
    expect(deleted.status).toBe(204);
    expect(deleted.text).toBe("");

    const missing = await request(app).get("/api/runs/run-0001");
    expect(missing.status).toBe(404);
    const listed = await request(app).get("/api/runs");
    expect(listed.body).not.toContainEqual(expect.objectContaining({ id: "run-0001" }));
  });

  it("returns the documented error for deleting an unknown run", async () => {
    const res = await request(app).delete("/api/runs/run-9999");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "run not found", id: "run-9999" });
  });

  it("does not delete a running run", async () => {
    const store = new RunStore();
    const running = store.create({ vehicleId: "WVW-7777", cycle: "WLTC", co2GramsPerKm: 88.1 });
    running.status = "running";
    const runningApp = buildApp(store);

    const res = await request(runningApp).delete(`/api/runs/${running.id}`);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "run is in progress", id: running.id });
    expect((await request(runningApp).get(`/api/runs/${running.id}`)).status).toBe(200);
  });

  it("creates a run", async () => {
    const res = await request(app)
      .post("/api/runs")
      .send({ vehicleId: "WVW-7777", cycle: "WLTC", co2GramsPerKm: 88.1 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ vehicleId: "WVW-7777", status: "planned" });
    expect(res.body.id).toMatch(/^run-\d{4}$/);
  });

  it("rejects invalid input with details", async () => {
    const res = await request(app).post("/api/runs").send({ vehicleId: "", cycle: "FOO", co2GramsPerKm: "x" });
    expect(res.status).toBe(400);
    expect(res.body.details).toHaveLength(3);
  });
});
