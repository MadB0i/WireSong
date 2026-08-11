import { beforeEach, describe, expect, it, vi } from "vitest";

describe("voice pack selection", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("defaults to ambient on module load", async () => {
    const synth = await import("./synth");
    expect(synth.getVoicePack()).toBe("ambient");
  });

  it("setVoicePack then getVoicePack returns the selected pack", async () => {
    const synth = await import("./synth");
    synth.setVoicePack("chiptune");
    expect(synth.getVoicePack()).toBe("chiptune");
    synth.setVoicePack("orchestral");
    expect(synth.getVoicePack()).toBe("orchestral");
  });

  it("fresh module import is back at ambient (no state leak)", async () => {
    const synth = await import("./synth");
    expect(synth.getVoicePack()).toBe("ambient");
  });
});
