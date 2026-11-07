// Game rules with no DOM access. Randomness comes in through `rng` so tests can control it.

export const SPECIAL = ['s', 'p', 'e', 'c', 'i', 'a', 'l'];
export const MAX_ATTACKS = 3;
export const MAX_BASE_LEVEL = 3;
export const PRIME_LEVEL = 4;

export const RULES = {
  statCap: 10,
  hpBase: 20,
  hpPerEndurance: 3,
  staminaBase: 6,
  staminaPerAgility: 1,
  staminaRegen: 1,
  strengthPerDamage: 2, // +1 damage per this many Strength
  hitBase: 72,
  hitPerPerception: 3,
  dodgePerAgility: 2,
  hitMin: 50,
  critBase: 2,
  critPerLuck: 3,
  critMultiplier: 1.5,
  healAfterWin: 20, // % of max HP recovered after a win
  healPerCharisma: 2, // extra % per point of Charisma
  bonusRewardPerIntelligence: 5, // % chance of a second reward after a win
  healRewardPercent: 50,
  rewardChoices: 3,
  extraChoicePerception: 10, // Perception needed for a 4th reward option
  enemyHpStart: 0.5, // Wild characters start well below a player's HP and catch up
  enemyHpPerWave: 0.07,
  enemyBonusDamageStart: -1, // Early wild characters hit softer
  wavesPerEnemyBonusDamage: 5,
  alphaEvery: 5,
  alphaExtraHpMin: 5,
  alphaExtraHpMax: 10,
  primeAfterRestMultiplier: 1.5, // Prime damage when the target's latest action was a rest
  equipmentDropChance: 30, // % chance any beaten enemy drops equipment
  alphaDropChance: 10, // % chance a beaten Alpha drops an item
  exhaustionStartsOnTurn: 20,
};

export const STAT_INFO = {
  s: { name: 'Strength', effect: `+1 attack damage per ${RULES.strengthPerDamage} points` },
  p: { name: 'Perception', effect: `+${RULES.hitPerPerception}% chance to hit per point` },
  e: { name: 'Endurance', effect: `+${RULES.hpPerEndurance} max HP per point` },
  c: { name: 'Charisma', effect: `After a win, recover ${RULES.healAfterWin}% max HP, +${RULES.healPerCharisma}% per point` },
  i: { name: 'Intelligence', effect: `+${RULES.bonusRewardPerIntelligence}% chance per point of a second reward` },
  a: { name: 'Agility', effect: `Acts first, +1 stamina, -${RULES.dodgePerAgility}% enemy hit chance per point` },
  l: { name: 'Luck', effect: `+${RULES.critPerLuck}% critical hit chance per point` },
};

export const maxHp = (stats) => RULES.hpBase + RULES.hpPerEndurance * stats.e;
export const maxStamina = (stats) => RULES.staminaBase + RULES.staminaPerAgility * stats.a;
export const critChance = (stats) => RULES.critBase + RULES.critPerLuck * stats.l;
export const hitChance = (attackerStats, targetStats, targetDodge = 0) =>
  Math.min(100, Math.max(RULES.hitMin,
    RULES.hitBase + RULES.hitPerPerception * attackerStats.p - RULES.dodgePerAgility * targetStats.a - targetDodge));

export const RARITY_WEIGHTS = { common: 60, uncommon: 25, rare: 11, epic: 4 };

// Equipment bonuses; `startRoundShild` keeps the spelling used in equiptment.json.
export const gearBonuses = (gear) => ({
  shield: gear?.startRoundShild ?? 0,
  dodge: gear?.dodgeChance ?? 0,
  reduction: gear?.damageReduction ?? 0,
  hp: gear?.maxHealthBonus ?? 0,
});
export const runMaxHp = (run) => maxHp(run.stats) + gearBonuses(run.equipment).hp;

export const levelLabel = (level) => (level === PRIME_LEVEL ? 'Prime' : `Lv ${level}`);

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

function shuffled(list, rng) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// What an attack does at a level. Prime deals damage as if it were one level past 3.
export function attackAtLevel(def, level) {
  const damage = def.startingDamage + def.damagePerLevel * (level - 1);
  const base = { name: def.name, level, damage };
  if (level === PRIME_LEVEL) return { ...base, ...def.prime };
  return { ...base, staminaCost: def.staminaCost, timesHit: 1, lifeSteal: 0, addedShield: 0, stun: false };
}

// --- Fighters ---

function createFighter(side, displayName, character, stats, attacks) {
  return {
    side,
    name: displayName,
    character,
    picture: character.picture,
    passive: character.passive ?? {},
    stats,
    attacks,
    hp: maxHp(stats),
    maxHp: maxHp(stats),
    stamina: maxStamina(stats),
    maxStamina: maxStamina(stats),
    shield: 0,
    gear: gearBonuses(null),
    stunned: false,
    stunImmune: false,
    bonusDamage: 0,
    primeSpent: false, // A Prime attack works once per battle.
    lastAction: null,
  };
}

// Wild characters always have exactly 2 level 1 attacks; later waves make them tougher instead.
// Alphas add a third attack at Prime, plus a little extra health.
export function createEnemy(character, attackDefs, wave, rng = Math.random) {
  const [first, second, third] = shuffled(attackDefs, rng);
  const attacks = [attackAtLevel(first, 1), attackAtLevel(second, 1)];
  const isAlpha = wave % RULES.alphaEvery === 0;
  if (isAlpha) attacks.push(attackAtLevel(third, PRIME_LEVEL));
  const enemy = createFighter('enemy', `${isAlpha ? 'Alpha' : 'Wild'} ${character.name}`, character, { ...character.stats }, attacks);

  const hpScale = RULES.enemyHpStart + RULES.enemyHpPerWave * (wave - 1);
  enemy.maxHp = Math.round(enemy.maxHp * hpScale);
  if (isAlpha) {
    const range = RULES.alphaExtraHpMax - RULES.alphaExtraHpMin + 1;
    enemy.maxHp += RULES.alphaExtraHpMin + Math.floor(rng() * range);
  }
  enemy.hp = enemy.maxHp;
  enemy.bonusDamage = RULES.enemyBonusDamageStart + Math.floor((wave - 1) / RULES.wavesPerEnemyBonusDamage);
  enemy.isAlpha = isAlpha;
  return enemy;
}

// A Prime attack stays usable at level 3 as well, as a second move in the same attack slot.
function createPlayerFighter(run, attackDefs) {
  const attacks = run.attacks.flatMap(({ name, level }) => {
    const def = attackDefs.find((candidate) => candidate.name === name);
    const levels = level === PRIME_LEVEL ? [MAX_BASE_LEVEL, PRIME_LEVEL] : [level];
    return levels.map((usableLevel) => attackAtLevel(def, usableLevel));
  });
  const fighter = createFighter('player', run.character.name, run.character, { ...run.stats }, attacks);
  fighter.gear = gearBonuses(run.equipment);
  fighter.maxHp += fighter.gear.hp;
  fighter.hp = run.hp;
  return fighter;
}

export function pickWildCharacter(characters, rng = Math.random) {
  return pick(characters, rng); // Any character can appear, including the player's own.
}

export function startBattle(run, enemyCharacter, attackDefs, rng = Math.random) {
  return {
    player: createPlayerFighter(run, attackDefs),
    enemy: createEnemy(enemyCharacter, attackDefs, run.wave, rng),
    winner: null,
    turn: 0,
  };
}

// The player wins agility ties.
export function turnOrder(battle) {
  const { player, enemy } = battle;
  return player.stats.a >= enemy.stats.a ? [player, enemy] : [enemy, player];
}

export const canUseAttack = (fighter, attack) =>
  attack.staminaCost <= fighter.stamina && !(attack.level === PRIME_LEVEL && fighter.primeSpent);

// True when the player's Prime would get the bonus if used this turn. A slower player can't
// know yet, because the enemy still has to act first.
export const playerPrimeBonusReady = (battle) =>
  turnOrder(battle)[0] === battle.player && battle.enemy.lastAction === 'rest';

export function chooseEnemyAction(enemy, target, rng = Math.random) {
  const usable = enemy.attacks
    .map((attack, index) => ({ attack, index }))
    .filter(({ attack }) => canUseAttack(enemy, attack));
  if (usable.length === 0) return { type: 'rest' };
  // An Alpha pounces on a resting target with its Prime.
  const prime = usable.find(({ attack }) => attack.level === PRIME_LEVEL);
  if (prime && target.lastAction === 'rest') return { type: 'attack', index: prime.index };
  return { type: 'attack', index: pick(usable, rng).index };
}

// --- Turn resolution ---

function snapshot(battle) {
  const view = ({ hp, maxHp: max, stamina, maxStamina: maxSt, shield, stunned, primeSpent }) =>
    ({ hp, maxHp: max, stamina, maxStamina: maxSt, shield, stunned, primeSpent });
  return { player: view(battle.player), enemy: view(battle.enemy) };
}

function computeDamage(actor, attack, isCrit, afterRest) {
  let damage = attack.damage + Math.floor(actor.stats.s / RULES.strengthPerDamage) + actor.bonusDamage;
  if (actor.passive.lowHpDamage && actor.hp * 2 <= actor.maxHp) damage += actor.passive.lowHpDamage;
  if (afterRest) damage = Math.ceil(damage * RULES.primeAfterRestMultiplier);
  return isCrit ? Math.ceil(damage * RULES.critMultiplier) : damage;
}

function heal(fighter, amount) {
  const healed = Math.min(amount, fighter.maxHp - fighter.hp);
  fighter.hp += healed;
  return healed;
}

function performAttack(battle, actor, target, attack, rng, emit) {
  const isPrime = attack.level === PRIME_LEVEL;
  const afterRest = isPrime && target.lastAction === 'rest';
  actor.stamina -= attack.staminaCost;
  if (isPrime) actor.primeSpent = true;
  emit({ type: 'use', actor: actor.side, text: `${actor.name} uses ${isPrime ? 'Prime ' : ''}${attack.name}!` });
  if (afterRest) emit({ type: 'info', text: `${target.name} was resting, so it hits harder!` });

  const lifeSteal = attack.lifeSteal + (actor.passive.lifeSteal ?? 0);
  let landed = false;

  for (let i = 0; i < attack.timesHit && target.hp > 0 && actor.hp > 0; i++) {
    if (rng() * 100 >= hitChance(actor.stats, target.stats, target.gear.dodge)) {
      emit({ type: 'miss', target: target.side, text: `${actor.name} misses!` });
      continue;
    }
    landed = true;
    const isCrit = rng() * 100 < critChance(actor.stats);
    const reduced = computeDamage(actor, attack, isCrit, afterRest) - (target.passive.damageReduction ?? 0) - target.gear.reduction;
    const damage = Math.max(1, reduced);
    const absorbed = Math.min(target.shield, damage);
    target.shield -= absorbed;
    target.hp = Math.max(0, target.hp - (damage - absorbed));
    emit({
      type: 'hit', target: target.side, amount: damage, crit: isCrit,
      text: `${isCrit ? 'Critical hit! ' : ''}${target.name} takes ${damage} damage${absorbed ? ` (${absorbed} blocked)` : ''}.`,
    });

    if (lifeSteal > 0) {
      const healed = heal(actor, Math.ceil(damage * lifeSteal / 100));
      if (healed) emit({ type: 'heal', target: actor.side, amount: healed, text: `${actor.name} steals ${healed} HP.` });
    }
    // Spines don't fire on a killing blow, so a battle can never end in a double KO.
    if (target.hp > 0 && target.passive.thorns) {
      actor.hp = Math.max(0, actor.hp - target.passive.thorns);
      emit({
        type: 'hit', target: actor.side, amount: target.passive.thorns, crit: false,
        text: `${target.name}'s ${target.passive.name} deals ${target.passive.thorns} back.`,
      });
    }
  }

  if (attack.addedShield > 0 && actor.hp > 0) {
    actor.shield += attack.addedShield;
    emit({ type: 'shield', target: actor.side, amount: attack.addedShield, text: `${actor.name} gains ${attack.addedShield} shield.` });
  }
  if (attack.stun && landed && target.hp > 0) {
    if (target.stunImmune) {
      emit({ type: 'info', text: `${target.name} shrugs off the stun.` });
    } else {
      target.stunned = true;
      emit({ type: 'stun', target: target.side, text: `${target.name} is stunned!` });
    }
  }
}

function performAction(battle, actor, target, action, rng, emit) {
  if (action.type === 'rest') {
    const gained = Math.min(Math.ceil(actor.maxStamina / 2), actor.maxStamina - actor.stamina);
    actor.stamina += gained;
    emit({ type: 'rest', actor: actor.side, text: `${actor.name} catches their breath (+${gained} stamina).` });
    return;
  }
  performAttack(battle, actor, target, actor.attacks[action.index], rng, emit);
}

function endOfTurn(battle, emit) {
  for (const fighter of [battle.player, battle.enemy]) {
    const regen = RULES.staminaRegen + (fighter.passive.staminaRegen ?? 0);
    fighter.stamina = Math.min(fighter.maxStamina, fighter.stamina + regen);
    if (fighter.passive.hpRegen) {
      const healed = heal(fighter, fighter.passive.hpRegen);
      if (healed) emit({ type: 'heal', target: fighter.side, amount: healed, text: `${fighter.name}'s ${fighter.passive.name} restores ${healed} HP.` });
    }
  }
  applyExhaustion(battle, emit);
  emit({ type: 'tick' });
}

// Long fights hurt both sides more each turn, ignoring shields, so regen and lifesteal can't
// stall a battle forever. The enemy goes first, so the player survives a would-be double KO.
function applyExhaustion(battle, emit) {
  const damage = battle.turn - RULES.exhaustionStartsOnTurn + 1;
  if (damage <= 0) return;
  for (const fighter of [battle.enemy, battle.player]) {
    fighter.hp = Math.max(0, fighter.hp - damage);
    emit({ type: 'hit', target: fighter.side, amount: damage, crit: false, text: `Exhaustion costs ${fighter.name} ${damage} HP.` });
    if (fighter.hp === 0) return;
  }
}

// Plays one full turn and returns the events for the UI, each with the state right after it.
export function runTurn(battle, playerAction, rng = Math.random) {
  const events = [];
  const emit = (event) => events.push({ ...event, state: snapshot(battle) });
  if (playerAction.type === 'attack' && !canUseAttack(battle.player, battle.player.attacks[playerAction.index])) {
    throw new Error('That attack cannot be used right now');
  }
  battle.turn += 1;

  // Equipment tops shields back up at the start of every round without stacking.
  for (const fighter of [battle.player, battle.enemy]) {
    if (fighter.gear.shield > fighter.shield) {
      const gained = fighter.gear.shield - fighter.shield;
      fighter.shield = fighter.gear.shield;
      emit({ type: 'shield', target: fighter.side, amount: gained, text: `${fighter.name}'s equipment gives ${gained} shield.` });
    }
  }

  for (const actor of turnOrder(battle)) {
    const target = actor === battle.player ? battle.enemy : battle.player;
    if (actor.stunned) {
      // A stun costs one action, and the next stun attempt fails, so nobody can be locked down.
      actor.stunned = false;
      actor.stunImmune = true;
      actor.lastAction = 'stunned';
      emit({ type: 'stunned', actor: actor.side, text: `${actor.name} is stunned and can't move!` });
      continue;
    }
    actor.stunImmune = false;
    // The enemy decides on its own turn, so it can react to a player who rested just before it.
    const action = actor === battle.player ? playerAction : chooseEnemyAction(actor, target, rng);
    performAction(battle, actor, target, action, rng, emit);
    actor.lastAction = action.type;

    if (battle.player.hp <= 0 || battle.enemy.hp <= 0) break;
  }

  if (battle.player.hp > 0 && battle.enemy.hp > 0) endOfTurn(battle, emit);

  if (battle.player.hp <= 0) battle.winner = 'enemy';
  else if (battle.enemy.hp <= 0) battle.winner = 'player';

  if (battle.winner) {
    const loser = battle.winner === 'player' ? battle.enemy : battle.player;
    emit({ type: 'faint', target: loser.side, text: `${loser.name} is down!` });
  }
  return events;
}

// --- Runs and rewards ---

// A character's stats for a run after consuming items. Each item gives +1 to its stat, up to the cap.
export function boostedStats(character, consumedItems = []) {
  const stats = { ...character.stats };
  for (const { stat } of consumedItems) stats[stat] = Math.min(RULES.statCap, stats[stat] + 1);
  return stats;
}

export function newRun(character, startingAttackNames, consumedItems = []) {
  const stats = boostedStats(character, consumedItems);
  return {
    character,
    stats,
    hp: maxHp(stats),
    attacks: startingAttackNames.map((name) => ({ name, level: 1 })),
    wave: 1,
    primeUsed: false,
    equipment: null, // One piece at a time, swapped when a better one drops
  };
}

// Banks a won battle and moves on to the next wave.
export function finishBattle(run, battle, rng = Math.random) {
  const max = runMaxHp(run);
  const percent = RULES.healAfterWin + run.stats.c * RULES.healPerCharisma;
  const healed = Math.min(max - battle.player.hp, Math.ceil(max * percent / 100));
  run.hp = battle.player.hp + healed;
  run.wave += 1;
  return { healed, bonusReward: rng() * 100 < run.stats.i * RULES.bonusRewardPerIntelligence };
}

export function rewardChoiceCount(run) {
  return RULES.rewardChoices + (run.stats.p >= RULES.extraChoicePerception ? 1 : 0);
}

// Only one attack per run may go Prime, and it is always offered once an attack qualifies.
export function rollRewards(run, attackDefs, rng = Math.random) {
  const known = new Set(run.attacks.map((attack) => attack.name));
  const rewards = [];
  const choices = rewardChoiceCount(run);

  const primeTarget = run.primeUsed ? -1 : run.attacks.findIndex((attack) => attack.level === MAX_BASE_LEVEL);
  if (primeTarget >= 0) rewards.push({ type: 'prime', index: primeTarget, name: run.attacks[primeTarget].name });

  const pools = {
    upgrade: run.attacks
      .map((attack, index) => ({ type: 'upgrade', index, name: attack.name, level: attack.level + 1 }))
      .filter((reward) => reward.level <= MAX_BASE_LEVEL),
    learn: attackDefs.filter((def) => !known.has(def.name)).map((def) => ({ type: 'learn', name: def.name })),
    stat: SPECIAL.filter((stat) => run.stats[stat] < RULES.statCap).map((stat) => ({ type: 'stat', stat })),
    heal: run.hp < runMaxHp(run) ? [{ type: 'heal' }] : [],
  };

  // One reward per kind first so the choices differ, then fill any gap from what's left.
  const kinds = shuffled(Object.keys(pools).filter((kind) => pools[kind].length > 0), rng);
  for (const kind of kinds) {
    if (rewards.length < choices) rewards.push(pick(pools[kind], rng));
  }
  const leftovers = shuffled(Object.values(pools).flat().filter((reward) => !rewards.includes(reward)), rng);
  while (rewards.length < choices && leftovers.length > 0) rewards.push(leftovers.pop());
  return rewards;
}

// `replaceIndex` says which attack to forget when learning with all slots full.
export function applyReward(run, reward, replaceIndex = null) {
  switch (reward.type) {
    case 'prime':
      if (run.primeUsed) throw new Error('Only one Prime attack per run');
      run.attacks[reward.index].level = PRIME_LEVEL;
      run.primeUsed = true;
      break;
    case 'upgrade':
      run.attacks[reward.index].level = reward.level;
      break;
    case 'learn':
      if (run.attacks.length < MAX_ATTACKS) run.attacks.push({ name: reward.name, level: 1 });
      else if (replaceIndex === null) throw new Error('Choose an attack to forget');
      else run.attacks[replaceIndex] = { name: reward.name, level: 1 };
      break;
    case 'stat':
      run.stats[reward.stat] += 1;
      if (reward.stat === 'e') run.hp += RULES.hpPerEndurance;
      break;
    case 'heal':
      run.hp = Math.min(runMaxHp(run), run.hp + Math.ceil(runMaxHp(run) * RULES.healRewardPercent / 100));
      break;
    default:
      throw new Error(`Unknown reward: ${reward.type}`);
  }
}

// --- Points, shop and inventory (kept between runs) ---

// Accepts whatever was saved, so a corrupt or outdated save can't break the game.
export function normalizeProfile(raw) {
  const inventory = {};
  for (const [name, count] of Object.entries(raw?.inventory ?? {})) {
    if (Number.isInteger(count) && count > 0) inventory[name] = count;
  }
  const points = Number.isInteger(raw?.points) && raw.points > 0 ? raw.points : 0;
  return { points, inventory };
}

export const ownedCount = (profile, itemName) => profile.inventory[itemName] ?? 0;

export function addToInventory(profile, itemName) {
  profile.inventory[itemName] = ownedCount(profile, itemName) + 1;
}

export function buyItem(profile, item) {
  if (profile.points < item.price) throw new Error(`Not enough points for ${item.name}`);
  profile.points -= item.price;
  addToInventory(profile, item.name);
}

export function consumeItems(profile, items) {
  for (const { name } of items) {
    const left = ownedCount(profile, name) - 1;
    if (left < 0) throw new Error(`No ${name} left to use`);
    if (left === 0) delete profile.inventory[name];
    else profile.inventory[name] = left;
  }
}

// 1 point per kill. Every cleared wave is one kill.
export const killsInRun = (run) => run.wave - 1;

export function awardRunPoints(profile, run) {
  const earned = killsInRun(run);
  profile.points += earned;
  return earned;
}

export function rollAlphaDrop(enemy, items, rng = Math.random) {
  if (!enemy.isAlpha || items.length === 0) return null;
  return rng() * 100 < RULES.alphaDropChance ? pick(items, rng) : null;
}

// Any beaten enemy can drop one piece of equipment, picked by rarity weight.
export function rollEquipmentDrop(equipment, rng = Math.random) {
  if (equipment.length === 0 || rng() * 100 >= RULES.equipmentDropChance) return null;
  const weight = (gear) => RARITY_WEIGHTS[gear.rarity] ?? 1;
  let roll = rng() * equipment.reduce((sum, gear) => sum + weight(gear), 0);
  for (const gear of equipment) {
    roll -= weight(gear);
    if (roll < 0) return gear;
  }
  return equipment[equipment.length - 1];
}

// Only one piece can be worn. Swapping keeps current HP unless the new piece lowers max HP below it.
export function equipGear(run, gear) {
  const before = runMaxHp(run);
  const previous = run.equipment;
  run.equipment = gear;
  const delta = runMaxHp(run) - before;
  run.hp = Math.min(runMaxHp(run), Math.max(1, run.hp + Math.max(0, delta)));
  return previous;
}
