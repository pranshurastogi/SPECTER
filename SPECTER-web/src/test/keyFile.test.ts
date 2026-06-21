import { describe, it, expect } from "vitest";
import { parseKeyFile } from "@/lib/crypto/keyFile";

const valid = {
  spending_pk: "0xspk",
  spending_sk: "0xssk",
  viewing_pk: "0xvpk",
  viewing_sk: "0xvsk",
  meta_address: "0xmeta",
};

describe("parseKeyFile", () => {
  it("returns the five key fields for a valid file", () => {
    expect(parseKeyFile(JSON.stringify(valid))).toEqual(valid);
  });

  it("strips unknown extra fields", () => {
    const result = parseKeyFile(JSON.stringify({ ...valid, view_tag: 7, junk: "x" }));
    expect(result).toEqual(valid);
    expect(result).not.toHaveProperty("view_tag");
    expect(result).not.toHaveProperty("junk");
  });

  it("throws on non-JSON input", () => {
    expect(() => parseKeyFile("not json")).toThrow(/valid JSON/i);
  });

  it("throws when a required field is missing", () => {
    const { spending_sk, ...rest } = valid;
    expect(() => parseKeyFile(JSON.stringify(rest))).toThrow(/spending_sk/);
  });

  it("throws when a required field is empty", () => {
    expect(() => parseKeyFile(JSON.stringify({ ...valid, meta_address: "" }))).toThrow(/meta_address/);
  });

  it("throws when a required field is not a string", () => {
    expect(() => parseKeyFile(JSON.stringify({ ...valid, viewing_pk: 123 }))).toThrow(/viewing_pk/);
  });
});
