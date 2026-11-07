// Loads and validates public/characters.json and public/attacks.json.
// Breaking a rule from info.txt stops the server at startup with a list of what to fix.
const fs = require('node:fs');
const path = require('node:path');

const SPECIAL = ['s', 'p', 'e', 'c', 'i', 'a', 'l'];
const BASE_STAT_POINTS = 30;
const PASSIVE_PENALTY = 5;
const PLACEHOLDER = 'placeHolder.png';

// JSON that also accepts trailing commas, so hand-edited data files don't break.
function parseLooseJson(text) {
  return JSON.parse(text.replace(/("(?:[^"\\]|\\.)*")|,(\s*[}\]])/g, (_, str, close) => str ?? close));
}

function hasPassive(character) {
  return Object.keys(character.passive ?? {}).length > 0;
}

function validateCharacters(characters) {
  const errors = [];
  const namesSeen = new Set();
  const statsSeen = new Map();

  for (const character of characters) {
    const { name, stats = {} } = character;
    if (namesSeen.has(name)) errors.push(`${name}: duplicate character name`);
    namesSeen.add(name);

    const values = SPECIAL.map((key) => stats[key]);
    if (!values.every((v) => Number.isInteger(v) && v >= 1 && v <= 10)) {
      errors.push(`${name}: each SPECIAL stat must be a whole number from 1 to 10`);
    }

    const expected = BASE_STAT_POINTS - (hasPassive(character) ? PASSIVE_PENALTY : 0);
    const total = values.reduce((sum, v) => sum + v, 0);
    if (total !== expected) errors.push(`${name}: stats add up to ${total}, expected ${expected}`);

    const key = values.join(',');
    if (statsSeen.has(key)) errors.push(`${name}: same stats as ${statsSeen.get(key)}`);
    else statsSeen.set(key, name);
  }
  return errors;
}

function normalizeAttack(raw) {
  const prime = raw.prime ?? {};
  return {
    name: raw.name,
    startingDamage: Number(raw.startingDamage),
    damagePerLevel: Number(raw.damagePerLevel),
    staminaCost: Number(raw.staminaCost),
    prime: {
      staminaCost: Number(prime.staminaCost),
      timesHit: Number(prime.timesHit),
      lifeSteal: Number(prime.lifeSteal),
      addedShield: Number(prime.addedShield),
      stun: prime.stun === true,
    },
  };
}

function validateAttacks(attacks) {
  const errors = [];
  const namesSeen = new Set();
  for (const attack of attacks) {
    if (namesSeen.has(attack.name)) errors.push(`${attack.name}: duplicate attack name`);
    namesSeen.add(attack.name);

    const { stun, ...primeNumbers } = attack.prime;
    const numbers = [attack.startingDamage, attack.damagePerLevel, attack.staminaCost, ...Object.values(primeNumbers)];
    if (!numbers.every(Number.isFinite)) errors.push(`${attack.name}: has a missing or non-numeric value`);
  }
  if (attacks.length < 3) errors.push('attacks.json: needs at least 3 attacks (Alphas use 3)');
  return errors;
}

function validateItems(items) {
  const errors = [];
  const namesSeen = new Set();
  for (const { name, stat, price } of items) {
    if (namesSeen.has(name)) errors.push(`${name}: duplicate item name`);
    namesSeen.add(name);
    if (!SPECIAL.includes(stat)) errors.push(`${name}: "stat" must be one of ${SPECIAL.join(', ')}`);
    if (!Number.isInteger(price) || price < 1) errors.push(`${name}: "price" must be a whole number of at least 1`);
  }
  return errors;
}

const RARITIES = ['common', 'uncommon', 'rare', 'epic'];
const GEAR_EFFECTS = ['startRoundShild', 'dodgeChance', 'damageReduction', 'maxHealthBonus'];

// Equipment numbers may be written as strings ("3"), so they are converted before checking.
function normalizeEquipment(raw) {
  const gear = { name: raw.name, rarity: raw.rarity };
  for (const key of GEAR_EFFECTS) gear[key] = Number(raw[key] ?? 0);
  return gear;
}

function validateEquipment(equipment) {
  const errors = [];
  const namesSeen = new Set();
  for (const gear of equipment) {
    if (namesSeen.has(gear.name)) errors.push(`${gear.name}: duplicate equipment name`);
    namesSeen.add(gear.name);
    if (!RARITIES.includes(gear.rarity)) errors.push(`${gear.name}: "rarity" must be one of ${RARITIES.join(', ')}`);
    for (const key of GEAR_EFFECTS) {
      if (!Number.isInteger(gear[key]) || gear[key] < 0) errors.push(`${gear.name}: "${key}" must be a whole number, 0 or more`);
    }
    if (GEAR_EFFECTS.every((key) => gear[key] === 0)) errors.push(`${gear.name}: has no effect`);
  }
  return errors;
}

function loadGameData(publicDir = path.join(__dirname, '..', 'public')) {
  const read = (file) => parseLooseJson(fs.readFileSync(path.join(publicDir, file), 'utf8'));
  const attacks = read('attacks.json').map(normalizeAttack);
  const items = read('items.json');
  const equipment = read('equiptment.json').map(normalizeEquipment);

  const characters = read('characters.json').map((character) => {
    // Characters without a picture on disk get the placeholder.
    const exists = character.picture && fs.existsSync(path.join(publicDir, 'pictures', character.picture));
    return {
      ...character,
      passive: hasPassive(character) ? character.passive : null,
      picture: `/pictures/${exists ? character.picture : PLACEHOLDER}`,
    };
  });

  const errors = [...validateCharacters(characters), ...validateAttacks(attacks), ...validateItems(items), ...validateEquipment(equipment)];
  if (errors.length) throw new Error(`Invalid game data:\n  - ${errors.join('\n  - ')}`);
  return { characters, attacks, items, equipment };
}

module.exports = { loadGameData, parseLooseJson, validateCharacters, validateItems, validateEquipment };
