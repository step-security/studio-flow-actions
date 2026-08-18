import { checkRepositoryPath } from "../config/paths";

/**
 * CONFIG_PATH arrives as an action input, so unlike the flow paths inside the
 * configuration file it is not covered by the schema. These cases pin the guard
 * that keeps it inside the repository.
 */
describe("repository path checking", () => {
  it.each([
    ["a parent traversal", "../secrets.json"],
    ["a nested traversal", "config/../../secrets.json"],
    ["a bare parent", ".."],
    ["a traversal after ./", "./../secrets.json"],
  ])("rejects %s", (_label, input) => {
    const result = checkRepositoryPath(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/traverses upwards/);
  });

  it.each([
    ["a unix absolute path", "/etc/passwd"],
    ["a root-relative config", "/studio-config.json"],
  ])("rejects %s", (_label, input) => {
    const result = checkRepositoryPath(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/is absolute/);
  });

  it("accepts a plain filename", () => {
    expect(checkRepositoryPath("studio-config.json")).toEqual({
      ok: true,
      path: "studio-config.json",
    });
  });

  it("accepts a nested path", () => {
    expect(checkRepositoryPath("config/studio.json")).toEqual({
      ok: true,
      path: "config/studio.json",
    });
  });

  it("strips a leading ./", () => {
    expect(checkRepositoryPath("./config/studio.json")).toEqual({
      ok: true,
      path: "config/studio.json",
    });
  });

  it("allows .. inside a filename rather than as a segment", () => {
    expect(checkRepositoryPath("weird..name.json")).toEqual({
      ok: true,
      path: "weird..name.json",
    });
  });
});
