/** Tests for building model-facing tool definitions from Zod schemas. */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toolDefinition } from "../src/lib/model/toolDefs";
import { ToolArgSchemas } from "../src/lib/tools/toolSchemas";

describe("toolDefinition", () => {
  it("keeps the given name and description", () => {
    const def = toolDefinition("search", "Search for things", z.object({ q: z.string() }));
    expect(def.name).toBe("search");
    expect(def.description).toBe("Search for things");
  });

  it("describes the schema as an object with its properties and required fields", () => {
    const def = toolDefinition(
      "search",
      "Search for things",
      z.object({ city: z.string(), limit: z.number().optional() }),
    );
    expect(def.parameters).toMatchObject({ type: "object" });
    expect(def.parameters).toHaveProperty("properties.city");
    expect(def.parameters).toHaveProperty("properties.limit");
    expect(def.parameters).toHaveProperty("required", ["city"]);
  });

  it("strips the $schema marker some providers reject", () => {
    const def = toolDefinition("search", "Search for things", z.object({ q: z.string() }));
    expect(def.parameters).not.toHaveProperty("$schema");
  });

  it("describes the real findTwins schema with profile and goal properties", () => {
    const def = toolDefinition(
      "findTwins",
      "Find comparable engineers in the synthetic cohort",
      ToolArgSchemas.findTwins,
    );
    expect(def.parameters).toMatchObject({ type: "object" });
    expect(def.parameters).toHaveProperty("properties.profile");
    expect(def.parameters).toHaveProperty("properties.goal");
    expect(def.parameters).not.toHaveProperty("$schema");
  });
});
