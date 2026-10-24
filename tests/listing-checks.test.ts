import { describe, expect, it } from "vitest";
import { checkAgainstText, mileageMentions } from "@/lib/listing-checks";
import type { ParsedListing } from "@/lib/parse-listing";

const parsed = (fields: Partial<ParsedListing>): ParsedListing => ({
  manufacturer: "Honda", model: "Accord", known_model: true, year: 2018, mileage: null, fuel_type: null, transmission: null,
  body_type: null, drivetrain: null, engine_size: null, condition: null, owners: null, accident_history: null,
  asking_price: null, filled: [], conflicts: [], ...fields,
});
const checked = (fields: Partial<ParsedListing>, text: string) => {
  const r = parsed(fields);
  checkAgainstText(r, text);
  return r;
};

describe("checkAgainstText", () => {
  it("does not read a clean title as no accidents", () => {
    expect(checked({ accident_history: false }, "2018 Honda Accord, 70k miles, clean title, $15,000").accident_history).toBeNull();
  });

  it("accepts explicit no-accident wording", () => {
    for (const t of ["no accidents", "accident-free", "accident free", "never been in an accident", "clean Carfax", "clean history report", "0 accidents reported", "sin accidentes"]) {
      expect(checked({ accident_history: false }, `2018 Accord ${t}`).accident_history).toBe(false);
    }
  });

  it("needs an accident to be mentioned before reporting one", () => {
    expect(checked({ accident_history: true }, "2018 Accord 70k").accident_history).toBeNull();
    for (const t of ["minor fender bender", "rebuilt title", "front-end collision", "hail damage", "was in an accident"]) {
      expect(checked({ accident_history: true }, `2018 Accord, ${t}`).accident_history).toBe(true);
    }
  });

  it("drops condition and owners that are not stated", () => {
    const r = checked({ condition: "Excellent", owners: 1 }, "2018 Honda Accord, runs great, 70k");
    expect(r.condition).toBeNull();
    expect(r.owners).toBeNull();
    const s = checked({ condition: "Good", owners: 1 }, "2018 Accord, good condition, one owner");
    expect(s.condition).toBe("Good");
    expect(s.owners).toBe(1);
  });

  it("blanks mileage and reports a conflict when two are given", () => {
    const r = checked({ mileage: 64000 }, "2019 Civic, 64,000 miles on the engine, odometer reads 120,000 miles");
    expect(r.mileage).toBeNull();
    expect(r.conflicts).toEqual([{ field: "mileage", values: [64000, 120000] }]);
  });

  it("does not flag one mileage written two ways", () => {
    const r = checked({ mileage: 64000 }, "64k miles. Mileage: 64,000");
    expect(r.mileage).toBe(64000);
    expect(r.conflicts).toEqual([]);
  });
});

describe("mileageMentions", () => {
  it("reads common formats and ignores short distances", () => {
    expect(mileageMentions("64k miles")).toEqual([64000]);
    expect(mileageMentions("120,000 mi")).toEqual([120000]);
    expect(mileageMentions("80,000 km")).toEqual([49710]);
    expect(mileageMentions("odometer reads 95000")).toEqual([95000]);
    expect(mileageMentions("5 miles from downtown, 64k miles")).toEqual([64000]);
    expect(mileageMentions("2019 Honda Civic EX, 64k miles, automatic, one owner, no accidents, asking $17,900")).toEqual([64000]);
  });
});
