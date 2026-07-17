# Synthetic

Synthetic is a dependency-light, deterministic agent-based economic sandbox. The first prototype runs the model in the browser and renders a live city view so experiments can be observed without a build step or external service.

## Run it

```powershell
npm start
```

Then open <http://127.0.0.1:4173>.

For a syntax check:

```powershell
npm run check
```

For deterministic model and invariant tests:

```powershell
npm test
```

## What is modeled now

- Households with skill, preferences, cash, debt, employment, housing quality, rent burden, wellbeing and sentiment.
- Firms across food, making, services and technology with productivity, prices, payroll, vacancies, revenue, cash and survival.
- A labor market that separates workers, ranks candidates and matches vacancies to households.
- A goods market where households allocate consumption budgets and firms update prices from demand.
- Housing scarcity, rents, construction, subsidies and arrears.
- Government income tax, consumption tax, unemployment benefits, public spending and a base interest rate.
- Macro indicators: output, unemployment, inflation, housing burden, inequality, wages, trust and wellbeing.
- Deterministic scenarios: baseline, recession, rent squeeze, automation wave and an injectable demand shock.

## Important scientific boundary

This is an experimental model, not a claim that an economy can be reproduced exactly. It is an explicit set of mechanisms with exposed assumptions. “Accurate” should mean that the model is transparent, calibrated against data, tested against stylized facts and compared with alternative specifications—not that a single simulation output is treated as a prediction.

The current prototype is intentionally a small model with stylized parameters. It is useful for exploring feedback loops, not for policy advice. A research-grade version should add empirical calibration, uncertainty intervals, sensitivity analysis, validation suites and competing model specifications before making claims about real-world interventions.

## Suggested next architecture

The current browser engine is a useful vertical slice. For scale and research workflows, split it into:

1. A Python model service for calibration, Monte Carlo batches and scientific notebooks.
2. A versioned scenario schema shared with the client.
3. A TypeScript visualization client for live state streams, experiment comparison and replay.
4. A data layer for national accounts, labor-force statistics, household expenditure, housing and firm microdata.
5. A validation harness for stylized facts such as Beveridge-curve behavior, Engel curves, wage dispersion, firm size distributions and housing-market price pressure.

## Model notes

See [`docs/MODEL.md`](docs/MODEL.md) for the mechanism inventory, state variables, equations and roadmap.
