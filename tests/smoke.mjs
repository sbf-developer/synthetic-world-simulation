import assert from "node:assert/strict";
import { SyntheticEconomy } from "../src/simulation.js";

const metrics = ["gdp", "unemployment", "inflation", "rentBurden", "inequality", "avgWage", "trust", "housingRent", "governmentBalance"];
const scenarios = ["baseline", "recession", "rentSqueeze", "automation"];

for (const scenario of scenarios) {
  const economy = new SyntheticEconomy({ seed: 42 });
  economy.applyScenario(scenario);
  let state = economy.getState();

  for (let month = 0; month < 48; month += 1) {
    state = economy.step();
    for (const metric of metrics) {
      assert.ok(Number.isFinite(state.latest[metric]), `${scenario}: ${metric} must remain finite`);
    }
    assert.equal(state.households.length, state.latest.population, `${scenario}: household count drifted`);
    assert.ok(state.firms.length > 0, `${scenario}: all firms disappeared`);
    assert.ok(state.households.every((household) => Number.isFinite(household.wellbeing)), `${scenario}: invalid household wellbeing`);
    assert.ok(state.firms.every((firm) => firm.price > 0 && Number.isFinite(firm.price)), `${scenario}: invalid firm price`);
  }

  assert.equal(state.tick, 48, `${scenario}: simulation tick did not advance`);
  assert.ok(state.history.gdp.length <= 84, `${scenario}: history exceeded retention window`);
  console.log(`${scenario}: ok · month ${state.tick} · unemployment ${(state.latest.unemployment * 100).toFixed(1)}%`);
}
