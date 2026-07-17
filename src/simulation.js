const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rng, mean = 0, deviation = 1) {
  const u = Math.max(rng(), Number.EPSILON);
  const v = Math.max(rng(), Number.EPSILON);
  return mean + deviation * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function weightedChoice(rng, items, weight) {
  const total = items.reduce((sum, item) => sum + Math.max(0, weight(item)), 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let cursor = rng() * total;
  for (const item of items) {
    cursor -= Math.max(0, weight(item));
    if (cursor <= 0) return item;
  }
  return items[items.length - 1];
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function gini(values) {
  const positive = values.map((value) => Math.max(0, value)).sort((a, b) => a - b);
  const total = positive.reduce((sum, value) => sum + value, 0);
  if (!positive.length || total === 0) return 0;
  const weighted = positive.reduce((sum, value, index) => sum + (index + 1) * value, 0);
  return clamp((2 * weighted) / (positive.length * total) - (positive.length + 1) / positive.length, 0, 1);
}

const SECTORS = [
  { id: "food", name: "Food", color: "#f6c453", share: 0.27, basePrice: 110, productivity: 1.04 },
  { id: "making", name: "Making", color: "#7bd8c2", share: 0.20, basePrice: 165, productivity: 1.14 },
  { id: "services", name: "Services", color: "#86a8ff", share: 0.36, basePrice: 190, productivity: 1.00 },
  { id: "technology", name: "Technology", color: "#ca9bff", share: 0.17, basePrice: 260, productivity: 1.28 },
];

export const DEFAULT_POLICY = {
  population: 620,
  firms: 64,
  housingUnits: 635,
  construction: 5,
  wageFloor: 2050,
  incomeTax: 0.18,
  unemploymentBenefit: 0.55,
  housingSubsidy: 0.12,
  baseRate: 0.035,
  consumptionTax: 0.05,
};

const CITY = { columns: 24, rows: 14 };

export class SyntheticEconomy {
  constructor({ seed = 42, policy = {} } = {}) {
    this.seed = seed;
    this.policy = { ...DEFAULT_POLICY, ...policy };
    this.reset();
  }

  reset() {
    this.rng = mulberry32(this.seed);
    this.tick = 0;
    this.phase = "stable";
    this.shocks = [];
    this.households = [];
    this.firms = [];
    this.events = [{ type: "system", text: "Synthetic initialized with a seeded population", tick: 0 }];
    this.housingUnits = Math.round(this.policy.housingUnits);
    this.priceLevel = null;
    this.government = { cash: 2200000, balance: 0, taxRevenue: 0, spending: 0 };
    this.history = {
      gdp: [],
      unemployment: [],
      inflation: [],
      rentBurden: [],
      inequality: [],
      avgWage: [],
      trust: [],
      housingRent: [],
      governmentBalance: [],
    };
    this._initializeFirms();
    this._initializeHouseholds();
    this._matchLabor(true);
    this._updateHousing(true);
    this._recordSnapshot();
  }

  setPolicy(patch) {
    this.policy = { ...this.policy, ...patch };
    this.policy.population = Math.round(clamp(this.policy.population, 100, 1800));
    this.policy.firms = Math.round(clamp(this.policy.firms, 12, 180));
    this.policy.housingUnits = Math.round(clamp(this.policy.housingUnits, 100, 2000));
    this.policy.construction = clamp(this.policy.construction, 0, 40);
    this.policy.wageFloor = clamp(this.policy.wageFloor, 1200, 3400);
    this.policy.incomeTax = clamp(this.policy.incomeTax, 0, 0.45);
    this.policy.unemploymentBenefit = clamp(this.policy.unemploymentBenefit, 0, 0.9);
    this.policy.housingSubsidy = clamp(this.policy.housingSubsidy, 0, 0.5);
    this.policy.baseRate = clamp(this.policy.baseRate, 0, 0.12);
    this.policy.consumptionTax = clamp(this.policy.consumptionTax, 0, 0.2);
  }

  applyScenario(name) {
    const scenarios = {
      baseline: { label: "Stable", months: 0 },
      recession: { label: "Recession", months: 16, demand: 0.78, productivity: 0.96 },
      rentSqueeze: { label: "Rent squeeze", months: 20, housing: 0.76 },
      automation: { label: "Automation wave", months: 20, automation: 0.34, demand: 1.03 },
    };
    const scenario = scenarios[name] || scenarios.baseline;
    this.shocks = [];
    this.phase = scenario.label;
    if (scenario.months) {
      this.shocks.push({
        name,
        label: scenario.label,
        remaining: scenario.months,
        demand: scenario.demand || 1,
        productivity: scenario.productivity || 1,
        housing: scenario.housing || 1,
        automation: scenario.automation || 0,
      });
    }
    this.events.unshift({ type: "scenario", text: `${scenario.label} scenario loaded`, tick: this.tick });
  }

  addShock() {
    const shock = { name: "demandShock", label: "Demand shock", remaining: 8, demand: 0.68, productivity: 1, housing: 1, automation: 0 };
    this.shocks.push(shock);
    this.phase = "Demand shock";
    this.events.unshift({ type: "shock", text: "A sudden demand shock hit local firms", tick: this.tick });
  }

  step() {
    this.tick += 1;
    this.events = [];
    const currentShock = this._activeShock();
    const demandMultiplier = currentShock.demand;
    const productivityMultiplier = currentShock.productivity;
    const automation = currentShock.automation;

    this.housingUnits += Math.round(this.policy.construction);
    this._updateHousing(false, currentShock.housing);
    this._prepareFirms(demandMultiplier, productivityMultiplier, automation);
    const labor = this._matchLabor(false);
    this._payHouseholds();
    this._collectHousing();
    const market = this._clearGoodsMarket(demandMultiplier);
    const firmHealth = this._closeOrRepriceFirms(productivityMultiplier, automation);
    this._updateWellbeing();
    this.government.spending = this._calculateGovernmentSpending();
    this.government.balance = this.government.taxRevenue - this.government.spending;
    this.government.cash += this.government.taxRevenue - Math.max(0, this.government.spending - this.government.transferSpending);
    this._ageShock();
    this._recordSnapshot();

    this.events.push({ type: "labor", text: `${labor.hires} hires · ${labor.separations} separations`, tick: this.tick });
    this.events.push({ type: "market", text: `${market.transactions.toLocaleString()} household purchases cleared`, tick: this.tick });
    this.events.push({ type: "firms", text: `${firmHealth.closed} firms closed · ${firmHealth.opened} new firms seeded`, tick: this.tick });
    this.events.push({ type: "policy", text: `Policy mix: ${Math.round(this.policy.incomeTax * 100)}% tax · ${this.policy.wageFloor.toLocaleString()} wage floor`, tick: this.tick });
    return this.getState();
  }

  _activeShock() {
    const active = this.shocks.filter((shock) => shock.remaining > 0);
    return active.reduce((acc, shock) => ({
      demand: acc.demand * shock.demand,
      productivity: acc.productivity * shock.productivity,
      housing: acc.housing * shock.housing,
      automation: acc.automation + shock.automation,
    }), { demand: 1, productivity: 1, housing: 1, automation: 0 });
  }

  _ageShock() {
    this.shocks.forEach((shock) => { shock.remaining -= 1; });
    this.shocks = this.shocks.filter((shock) => shock.remaining > 0);
    if (!this.shocks.length && this.phase !== "Stable") this.phase = "stable";
  }

  _initializeFirms() {
    for (let index = 0; index < this.policy.firms; index += 1) {
      const sector = weightedChoice(this.rng, SECTORS, (item) => item.share);
      const firm = {
        id: `firm-${index + 1}`,
        name: `${sector.name} ${String(index + 1).padStart(2, "0")}`,
        sector: sector.id,
        x: 1 + Math.floor(this.rng() * (CITY.columns - 2)),
        y: 1 + Math.floor(this.rng() * (CITY.rows - 2)),
        productivity: clamp(sector.productivity * (0.78 + this.rng() * 0.46), 0.65, 1.7),
        price: sector.basePrice * (0.9 + this.rng() * 0.25),
        wageOffer: Math.max(this.policy.wageFloor, 2050 + normal(this.rng, 250, 180)),
        cash: 52000 + this.rng() * 54000,
        employees: [],
        vacancies: 0,
        revenue: 0,
        previousRevenue: 3600,
        payroll: 0,
        lastProfit: 0,
        alive: true,
      };
      this.firms.push(firm);
    }
  }

  _initializeHouseholds() {
    for (let index = 0; index < this.policy.population; index += 1) {
      const skill = clamp(normal(this.rng, 0.5, 0.19), 0.05, 0.98);
      const preference = SECTORS.map((sector) => clamp(0.25 + this.rng() * 0.9 + (sector.id === "technology" ? skill * 0.35 : 0), 0.1, 1.5));
      const household = {
        id: `household-${index + 1}`,
        age: Math.round(18 + this.rng() * 66),
        skill,
        x: Math.floor(this.rng() * CITY.columns),
        y: Math.floor(this.rng() * CITY.rows),
        preference,
        cash: clamp(1600 + skill * 3300 + normal(this.rng, 0, 750), 200, 10000),
        debt: this.rng() < 0.14 ? this.rng() * 10000 : 0,
        employed: false,
        employerId: null,
        wage: 0,
        income: 0,
        taxPaid: 0,
        benefit: 0,
        rent: 0,
        subsidy: 0,
        arrears: 0,
        homeQuality: 0.6 + this.rng() * 0.38,
        hasHome: true,
        wellbeing: 0.6,
        sentiment: 0.6,
      };
      this.households.push(household);
    }
  }

  _prepareFirms(demandMultiplier, productivityMultiplier, automation) {
    for (const firm of this.firms) {
      firm.revenue = 0;
      firm.payroll = 0;
      firm.vacancies = 0;
      const sector = SECTORS.find((item) => item.id === firm.sector);
      const sectorAutomation = firm.sector === "making" || firm.sector === "technology" ? automation : automation * 0.25;
      const sectorDemand = sector.share * this.policy.population;
      const scale = (sectorDemand / Math.max(1, this.firms.filter((item) => item.sector === firm.sector).length));
      const productivity = firm.productivity * productivityMultiplier * (1 + sectorAutomation);
      const target = Math.round(clamp(3 + scale * 1.2 * demandMultiplier / Math.max(0.7, productivity), 2, 34));
      while (firm.employees.length > target) {
        const householdId = firm.employees.pop();
        const household = this.households.find((item) => item.id === householdId);
        if (household) {
          household.employed = false;
          household.employerId = null;
          household.wage = 0;
        }
      }
      firm.vacancies = Math.max(0, target - firm.employees.length);
    }
  }

  _matchLabor(initial) {
    const unemployed = this.households.filter((household) => !household.employed);
    const openFirms = this.firms.filter((firm) => firm.alive && firm.vacancies > 0);
    let hires = 0;
    let separations = initial ? 0 : this.households.filter((household) => !household.employed).length;
    for (const firm of openFirms) {
      while (firm.vacancies > 0 && unemployed.length) {
        const sector = SECTORS.find((item) => item.id === firm.sector);
        const candidate = unemployed.reduce((best, household) => {
          const sectorFit = household.preference[SECTORS.indexOf(sector)];
          const score = household.skill * 0.62 + sectorFit * 0.2 + (household.x === firm.x ? 0.04 : 0) + this.rng() * 0.04;
          return !best || score > best.score ? { household, score } : best;
        }, null);
        if (!candidate) break;
        const household = candidate.household;
        const position = unemployed.indexOf(household);
        if (position >= 0) unemployed.splice(position, 1);
        household.employed = true;
        household.employerId = firm.id;
        household.wage = Math.max(this.policy.wageFloor, firm.wageOffer * (0.84 + household.skill * 0.28));
        firm.employees.push(household.id);
        firm.vacancies -= 1;
        hires += 1;
      }
    }
    separations = Math.max(0, separations - hires);
    return { hires, separations };
  }

  _updateHousing(initial, scenarioMultiplier = 1) {
    const occupied = this.households.length;
    const target = Math.max(0.1, this.housingUnits * scenarioMultiplier);
    const pressure = occupied / target;
    const baseRent = clamp(540 * Math.pow(pressure, 0.78), 320, 1700);
    const sorted = [...this.households].sort((a, b) => (b.skill + b.cash / 10000) - (a.skill + a.cash / 10000));
    const housed = new Set(sorted.slice(0, Math.min(this.housingUnits, sorted.length)).map((household) => household.id));
    for (const household of this.households) {
      household.hasHome = housed.has(household.id);
      household.rent = household.hasHome ? baseRent * (0.76 + household.homeQuality * 0.38) : 0;
      if (initial) household.arrears = 0;
    }
    this.rentIndex = baseRent;
  }

  _payHouseholds() {
    const employed = this.households.filter((household) => household.employed);
    const medianWage = this._median(employed.map((household) => household.wage)) || this.policy.wageFloor;
    this.government.taxRevenue = 0;
    this.government.transferSpending = 0;
    for (const household of this.households) {
      household.taxPaid = 0;
      household.benefit = 0;
      household.income = 0;
      if (household.employed) {
        const firm = this.firms.find((item) => item.id === household.employerId);
        const gross = household.wage;
        const tax = gross * this.policy.incomeTax;
        household.taxPaid = tax;
        household.income = gross - tax;
        household.cash += household.income;
        this.government.taxRevenue += tax;
        if (firm) {
          firm.cash -= gross;
          firm.payroll += gross;
        }
      } else {
        household.benefit = medianWage * this.policy.unemploymentBenefit;
        household.income = household.benefit;
        household.cash += household.benefit;
        this.government.cash -= household.benefit;
        this.government.transferSpending += household.benefit;
      }
      const debtInterest = household.debt * this.policy.baseRate / 12;
      household.cash = Math.max(0, household.cash - debtInterest);
    }
  }

  _collectHousing() {
    for (const household of this.households) {
      if (!household.hasHome) {
        household.rent = 0;
        household.subsidy = 0;
        household.arrears += 180;
        household.cash = Math.max(0, household.cash - 90);
        continue;
      }
      const incomeRank = clamp(household.cash / 7000, 0, 1);
      const subsidy = household.rent * this.policy.housingSubsidy * (1 - incomeRank);
      const due = household.rent - subsidy;
      const payment = Math.min(household.cash, due);
      household.cash -= payment;
      household.subsidy = subsidy;
      household.arrears += Math.max(0, due - payment);
      this.government.cash -= subsidy;
      this.government.transferSpending += subsidy;
    }
  }

  _clearGoodsMarket(demandMultiplier) {
    let transactions = 0;
    let totalSpending = 0;
    const sectorSpending = Object.fromEntries(SECTORS.map((sector) => [sector.id, 0]));
    for (const household of this.households) {
      const income = Math.max(1, household.income);
      const savingsDrag = clamp(household.cash / 12000, 0, 0.22);
      const consumptionRate = clamp(0.76 - savingsDrag * 0.55 + (1 - household.skill) * 0.06, 0.5, 0.9);
      const budget = Math.min(household.cash, income * consumptionRate * demandMultiplier + 60);
      if (budget <= 0) continue;
      const weights = SECTORS.map((sector, index) => sector.share * household.preference[index] * (sector.id === "food" ? 1.12 : 1));
      let remainder = budget;
      for (let index = 0; index < SECTORS.length; index += 1) {
        const sector = SECTORS[index];
        const share = weights[index] / weights.reduce((sum, value) => sum + value, 0);
        const spend = index === SECTORS.length - 1 ? remainder : budget * share;
        if (spend <= 0) continue;
        const candidates = this.firms.filter((firm) => firm.alive && firm.sector === sector.id);
        const firm = weightedChoice(this.rng, candidates, (item) => 1 / Math.max(1, item.price));
        if (!firm) continue;
        const taxed = spend * (1 + this.policy.consumptionTax);
        household.cash = Math.max(0, household.cash - taxed);
        const net = spend;
        firm.cash += net;
        firm.revenue += net;
        firm.previousRevenue = firm.previousRevenue * 0.7 + net * 0.3;
        sectorSpending[sector.id] += net;
        totalSpending += net;
        transactions += 1;
        remainder -= spend;
      }
    }
    const publicDemand = this.policy.population * 180 * demandMultiplier;
    for (const sector of SECTORS) {
      const candidates = this.firms.filter((firm) => firm.alive && firm.sector === sector.id);
      const firm = weightedChoice(this.rng, candidates, (item) => 1 / Math.max(1, item.price));
      if (!firm) continue;
      const spend = publicDemand * sector.share;
      firm.cash += spend;
      firm.revenue += spend;
      sectorSpending[sector.id] += spend;
      totalSpending += spend;
    }
    this.government.taxRevenue += totalSpending * this.policy.consumptionTax;
    return { transactions, totalSpending, sectorSpending };
  }

  _closeOrRepriceFirms(productivityMultiplier, automation) {
    let closed = 0;
    for (const firm of this.firms) {
      if (!firm.alive) continue;
      const sector = SECTORS.find((item) => item.id === firm.sector);
      const expected = Math.max(2000, firm.previousRevenue * (0.82 + sector.share));
      const demandRatio = firm.revenue / expected;
      const inflation = clamp((demandRatio - 0.9) * 0.045, -0.045, 0.055);
      firm.price = clamp(firm.price * (1 + inflation), sector.basePrice * 0.5, sector.basePrice * 3.2);
      const fixedCosts = 450 + firm.employees.length * 60 * (1 / Math.max(0.7, productivityMultiplier));
      firm.lastProfit = firm.revenue - firm.payroll - fixedCosts;
      firm.cash -= fixedCosts;
      const wagePressure = firm.vacancies > 0 ? 0.012 : (demandRatio < 0.72 ? -0.006 : 0.002);
      firm.wageOffer = Math.max(this.policy.wageFloor, firm.wageOffer * (1 + wagePressure));
      if (automation > 0 && (firm.sector === "making" || firm.sector === "technology")) {
        firm.productivity = clamp(firm.productivity * (1 + automation * 0.012), 0.65, 2.2);
      }
      if (firm.cash < -50000 || (firm.lastProfit < -18000 && demandRatio < 0.3)) {
        firm.alive = false;
        closed += 1;
        for (const householdId of firm.employees) {
          const household = this.households.find((item) => item.id === householdId);
          if (household) {
            household.employed = false;
            household.employerId = null;
            household.wage = 0;
          }
        }
        firm.employees = [];
      }
    }
    let opened = 0;
    if (closed > 0) {
      const alive = this.firms.filter((firm) => firm.alive);
      const needed = Math.min(closed, Math.max(0, this.policy.firms - alive.length));
      for (let index = 0; index < needed; index += 1) {
        const sector = weightedChoice(this.rng, SECTORS, (item) => item.share);
        this.firms.push({
          id: `firm-${this.firms.length + 1}`,
          name: `${sector.name} ${String(this.firms.length + 1).padStart(2, "0")}`,
          sector: sector.id,
          x: 1 + Math.floor(this.rng() * (CITY.columns - 2)),
          y: 1 + Math.floor(this.rng() * (CITY.rows - 2)),
          productivity: sector.productivity,
          price: sector.basePrice,
          wageOffer: Math.max(this.policy.wageFloor, 2100),
          cash: 58000,
          employees: [],
          vacancies: 0,
          revenue: 0,
          previousRevenue: 3200,
          payroll: 0,
          lastProfit: 0,
          alive: true,
        });
        opened += 1;
      }
    }
    return { closed, opened };
  }

  _calculateGovernmentSpending() {
    const publicServices = this.policy.population * 260;
    return this.government.transferSpending + publicServices;
  }

  _updateWellbeing() {
    for (const household of this.households) {
      const housingStress = household.hasHome ? clamp((household.rent - household.subsidy) / Math.max(1, household.income), 0, 1.2) : 1.1;
      const moneySecurity = clamp(Math.log10(1 + household.cash) / 4.4, 0, 1);
      household.wellbeing = clamp(0.34 * (household.employed ? 1 : 0.32) + 0.3 * (1 - housingStress / 1.4) + 0.28 * moneySecurity + 0.08 * household.homeQuality, 0.05, 0.98);
      household.sentiment = clamp(0.58 + (household.wellbeing - 0.6) * 0.8, 0.08, 0.94);
    }
  }

  _recordSnapshot() {
    const employed = this.households.filter((household) => household.employed);
    const incomes = this.households.map((household) => household.income);
    const priorRent = this.history.housingRent.at(-1) || this.rentIndex || 1;
    const priceLevel = average(this.firms.filter((firm) => firm.alive).map((firm) => firm.price / Math.max(1, SECTORS.find((sector) => sector.id === firm.sector).basePrice)));
    const priorPriceLevel = this.priceLevel ?? priceLevel;
    const goodsInflation = priorPriceLevel ? priceLevel / priorPriceLevel - 1 : 0;
    const rentInflation = priorRent ? this.rentIndex / priorRent - 1 : 0;
    const inflation = goodsInflation * 0.72 + rentInflation * 0.28;
    this.priceLevel = priceLevel;
    const unemployment = 1 - employed.length / Math.max(1, this.households.length);
    const inequality = gini(this.households.map((household) => household.cash + household.income * 2));
    const rentBurden = average(this.households.map((household) => household.hasHome ? (household.rent - household.subsidy) / Math.max(1, household.income) : 1));
    const wellbeing = average(this.households.map((household) => household.wellbeing));
    const trust = clamp(0.78 - unemployment * 0.88 - Math.abs(inflation) * 1.1 - Math.max(0, inequality - 0.34) * 0.44 + (wellbeing - 0.6) * 0.22, 0.08, 0.92);
    const gdp = this.firms.filter((firm) => firm.alive).reduce((sum, firm) => sum + firm.revenue, 0);
    const avgWage = average(employed.map((household) => household.wage));
    this.history.gdp.push(gdp);
    this.history.unemployment.push(unemployment);
    this.history.inflation.push(inflation);
    this.history.rentBurden.push(rentBurden);
    this.history.inequality.push(inequality);
    this.history.avgWage.push(avgWage);
    this.history.trust.push(trust);
    this.history.housingRent.push(this.rentIndex);
    this.history.governmentBalance.push(this.government.balance);
    for (const key of Object.keys(this.history)) {
      if (this.history[key].length > 84) this.history[key].shift();
    }
    this.latest = { gdp, unemployment, inflation, rentBurden, inequality, avgWage, trust, wellbeing, housingRent: this.rentIndex, housingUnits: this.housingUnits, population: this.households.length, employed: employed.length, firms: this.firms.filter((firm) => firm.alive).length, governmentBalance: this.government.balance, totalWealth: this.households.reduce((sum, household) => sum + household.cash, 0), medianIncome: this._median(incomes) };
  }

  _median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  _districts() {
    const districts = [];
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const members = this.households.filter((household) => Math.floor(household.x / 6) === x && Math.floor(household.y / 5) === y);
        districts.push({
          id: `${x}-${y}`,
          x,
          y,
          households: members.length,
          unemployment: members.length ? members.filter((household) => !household.employed).length / members.length : 0,
          rentBurden: average(members.map((household) => household.hasHome ? (household.rent - household.subsidy) / Math.max(1, household.income) : 1)),
          wellbeing: average(members.map((household) => household.wellbeing)),
        });
      }
    }
    return districts;
  }

  getState() {
    const sectorCounts = Object.fromEntries(SECTORS.map((sector) => [sector.id, this.firms.filter((firm) => firm.alive && firm.sector === sector.id).length]));
    return {
      tick: this.tick,
      monthLabel: `Month ${this.tick}`,
      phase: this.phase,
      policy: { ...this.policy },
      latest: { ...this.latest },
      history: Object.fromEntries(Object.entries(this.history).map(([key, values]) => [key, [...values]])),
      households: this.households.map((household) => ({ id: household.id, x: household.x, y: household.y, employed: household.employed, wellbeing: household.wellbeing, sentiment: household.sentiment, hasHome: household.hasHome })),
      firms: this.firms.filter((firm) => firm.alive).map((firm) => ({ id: firm.id, name: firm.name, x: firm.x, y: firm.y, sector: firm.sector, employees: firm.employees.length, vacancies: firm.vacancies, price: firm.price, profit: firm.lastProfit })),
      districts: this._districts(),
      sectorCounts,
      sectors: SECTORS.map((sector) => ({ ...sector })),
      events: [...this.events].reverse(),
      shocks: this.shocks.map((shock) => ({ label: shock.label, remaining: shock.remaining })),
    };
  }
}

export { CITY, SECTORS, clamp };
