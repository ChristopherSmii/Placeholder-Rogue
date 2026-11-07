import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  attackAtLevel, applyReward, createEnemy, finishBattle, newRun, rollRewards, runTurn, startBattle, turnOrder,
  maxHp, PRIME_LEVEL, SPECIAL, boostedStats, normalizeProfile, ownedCount, buyItem, consumeItems,
  awardRunPoints, rollAlphaDrop, runMaxHp, equipGear, rollEquipmentDrop, canUseAttack, chooseEnemyAction, playerPrimeBonusReady,
} from '../public/js/engine.mjs';

const require = createRequire(import.meta.url);
const { loadGameData, parseLooseJson, validateCharacters, validateItems, validateEquipment } = require('../lib/gameData.js');

const data = loadGameData();
const character = (name) => data.characters.find((c) => c.name === name);
const attack = (name) => data.attacks.find((a) => a.name === name);

// Rolls that always land and never crit: the hit roll is low, the crit roll is high.
// Enemies with no attacks make no rolls, so tests using this give the enemy none.
function hitNoCrit() {
  let hitRoll = true;
  return () => {
    const value = hitRoll ? 0 : 0.99;
    hitRoll = !hitRoll;
    return value;
  };
}

function battleBetween(playerName, enemyName, attacks = ['punch', 'jab'], rng = () => 0.5) {
  const run = newRun(character(playerName), attacks);
  return { run, battle: startBattle(run, character(enemyName), data.attacks, rng) };
}

test('shipped data obeys the stat rules', () => {
  for (const c of data.characters) {
    const total = Object.values(c.stats).reduce((a, b) => a + b, 0);
    assert.equal(total, c.passive ? 25 : 30, c.name);
  }
  const keys = data.characters.map((c) => Object.values(c.stats).join());
  assert.equal(new Set(keys).size, keys.length);
});

test('every character names a picture in characters.json', () => {
  const raw = parseLooseJson(fs.readFileSync(new URL('../public/characters.json', import.meta.url), 'utf8'));
  for (const c of raw) assert.match(c.picture, /^[\w-]+\.png$/, c.name);
});

test('a missing or absent picture falls back to the placeholder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamedata-'));
  const stats = (s) => ({ s, p: 5, e: 5, c: 5, i: 3, a: 3, l: 9 - s });
  fs.writeFileSync(path.join(dir, 'characters.json'), JSON.stringify([
    { name: 'NoField', stats: stats(4), passive: {} },
    { name: 'BadFile', stats: stats(3), passive: {}, picture: 'nope.png' },
  ]));
  fs.copyFileSync(new URL('../public/attacks.json', import.meta.url), path.join(dir, 'attacks.json'));
  fs.copyFileSync(new URL('../public/items.json', import.meta.url), path.join(dir, 'items.json'));
  fs.copyFileSync(new URL('../public/equiptment.json', import.meta.url), path.join(dir, 'equiptment.json'));
  const loaded = loadGameData(dir);
  fs.rmSync(dir, { recursive: true });
  for (const c of loaded.characters) assert.equal(c.picture, '/pictures/placeHolder.png', c.name);
});

test('items.json has one item per stat', () => {
  assert.equal(data.items.length, 7);
  assert.deepEqual(data.items.map((i) => i.stat).sort(), [...SPECIAL].sort());
});

test('item validation rejects a bad stat or price', () => {
  const errors = validateItems([{ name: 'X', stat: 'q', price: 0 }]);
  assert.equal(errors.length, 2);
});

test('a prime attack stays usable at level 3 without taking another slot', () => {
  const run = newRun(character('Rook'), ['punch', 'jab', 'kick']);
  run.attacks[0].level = PRIME_LEVEL;
  run.primeUsed = true;
  const battle = startBattle(run, character('Wren'), data.attacks);
  assert.equal(run.attacks.length, 3);
  assert.deepEqual(battle.player.attacks.map((a) => [a.name, a.level]),
    [['punch', 3], ['punch', PRIME_LEVEL], ['jab', 1], ['kick', 1]]);

  const stamina = battle.player.stamina;
  battle.enemy.attacks = [];
  runTurn(battle, { type: 'attack', index: 0 }, hitNoCrit());
  assert.equal(battle.player.stamina, stamina - attack('punch').staminaCost + 1);
  assert.equal(battle.enemy.stunned, false, 'level 3 has no prime effects');
});

test('consumed items add 1 to their stat for the run, up to the cap', () => {
  const item = (stat) => data.items.find((i) => i.stat === stat);
  const rook = character('Rook');
  const run = newRun(rook, ['punch', 'jab'], [item('e'), item('e'), item('s')]);
  assert.equal(run.stats.e, rook.stats.e + 2);
  assert.equal(run.stats.s, rook.stats.s + 1);
  assert.equal(run.hp, maxHp(run.stats));
  assert.equal(boostedStats(rook, [item('s'), item('s'), item('s')]).s, 10);
  assert.equal(rook.stats.s, 9, 'the character itself is unchanged');
});

test('buying spends points, consuming empties the inventory', () => {
  const item = data.items[0];
  const profile = normalizeProfile({ points: item.price + 1 });
  buyItem(profile, item);
  assert.equal(profile.points, 1);
  assert.equal(ownedCount(profile, item.name), 1);
  assert.throws(() => buyItem(profile, item));
  assert.equal(ownedCount(profile, item.name), 1);
  consumeItems(profile, [item]);
  assert.equal(ownedCount(profile, item.name), 0);
  assert.throws(() => consumeItems(profile, [item]));
});

test('a damaged save loads as an empty profile', () => {
  assert.deepEqual(normalizeProfile(null), { points: 0, inventory: {} });
  assert.deepEqual(normalizeProfile({ points: 'lots', inventory: { A: -1, B: 2.5, C: 2 } }), { points: 0, inventory: { C: 2 } });
});

test('a run pays 1 point per kill', () => {
  const profile = normalizeProfile({ points: 3 });
  const { run, battle } = battleBetween('Rook', 'Wren');
  assert.equal(awardRunPoints(normalizeProfile(null), run), 0);
  finishBattle(run, battle);
  finishBattle(run, battle);
  assert.equal(awardRunPoints(profile, run), 2);
  assert.equal(profile.points, 5);
});

test('only alphas drop items, and only at the slim chance', () => {
  const alpha = createEnemy(character('Rook'), data.attacks, 5);
  const wild = createEnemy(character('Rook'), data.attacks, 4);
  assert.equal(rollAlphaDrop(wild, data.items, () => 0), null);
  assert.ok(rollAlphaDrop(alpha, data.items, () => 0));
  assert.equal(rollAlphaDrop(alpha, data.items, () => 0.1), null);
  assert.ok(rollAlphaDrop(alpha, data.items, () => 0.099));
});

test('validation rejects duplicate stats and wrong totals', () => {
  const stats = { s: 3, p: 6, e: 5, c: 2, i: 4, a: 5, l: 5 };
  const errors = validateCharacters([
    { name: 'A', stats },
    { name: 'B', stats },
    { name: 'C', stats, passive: { name: 'X' } },
  ]);
  assert.ok(errors.some((e) => e.includes('B: same stats')));
  assert.ok(errors.some((e) => e.includes('C: stats add up to 30, expected 25')));
});

test('loose JSON accepts trailing commas but leaves strings alone', () => {
  assert.deepEqual(parseLooseJson('[{"a":",}",},]'), [{ a: ',}' }]);
});

test('wild characters have exactly 2 different level 1 attacks at any wave', () => {
  for (const wave of [1, 4, 41]) {
    const enemy = createEnemy(character('Rook'), data.attacks, wave);
    assert.equal(enemy.attacks.length, 2);
    assert.notEqual(enemy.attacks[0].name, enemy.attacks[1].name);
    assert.ok(enemy.attacks.every((a) => a.level === 1));
  }
});

test('every alpha has 2 level 1 attacks and a different prime attack', () => {
  for (const wave of [5, 10, 40]) {
    for (let i = 0; i < 20; i++) {
      const { attacks, isAlpha } = createEnemy(character('Rook'), data.attacks, wave);
      assert.equal(isAlpha, true);
      assert.deepEqual(attacks.map((a) => a.level), [1, 1, PRIME_LEVEL]);
      assert.equal(new Set(attacks.map((a) => a.name)).size, 3);
    }
  }
});

test('an alpha has 5 to 10 more HP than a wild character of the same wave', () => {
  const rook = character('Rook');
  // Wave 5 is an Alpha wave, so wave 5's wild HP comes from the same formula directly.
  const wildHp = Math.round(maxHp(rook.stats) * (0.5 + 0.07 * 4));
  const seen = new Set();
  for (const roll of [0, 0.2, 0.4, 0.6, 0.8, 0.999]) {
    seen.add(createEnemy(rook, data.attacks, 5, () => roll).maxHp - wildHp);
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [5, 6, 7, 8, 9, 10]);
});

test('the player can meet their own character', () => {
  const { battle } = battleBetween('Rook', 'Rook');
  assert.equal(battle.enemy.character.name, battle.player.character.name);
});

test('the higher agility acts first and the player wins ties', () => {
  const faster = battleBetween('Wren', 'Rook').battle; // 8 vs 4
  assert.equal(turnOrder(faster)[0].side, 'player');
  const slower = battleBetween('Rook', 'Wren').battle;
  assert.equal(turnOrder(slower)[0].side, 'enemy');
  const tie = battleBetween('Rook', 'Rook').battle;
  assert.equal(turnOrder(tie)[0].side, 'player');
});

test('attack levels scale, and prime uses its own values', () => {
  const punch = attack('punch');
  assert.deepEqual([1, 2, 3].map((l) => attackAtLevel(punch, l).damage), [2, 3, 4]);
  const prime = attackAtLevel(punch, PRIME_LEVEL);
  assert.equal(prime.damage, 5);
  assert.equal(prime.staminaCost, 4);
  assert.equal(prime.timesHit, 2);
  assert.equal(prime.stun, true);
});

test('only one attack can go prime in a run', () => {
  const run = newRun(character('Rook'), ['punch', 'jab']);
  run.attacks.forEach((a) => { a.level = 3; });
  const offer = rollRewards(run, data.attacks).find((r) => r.type === 'prime');
  assert.ok(offer, 'prime is offered once an attack reaches level 3');
  applyReward(run, offer);
  assert.equal(run.attacks[offer.index].level, PRIME_LEVEL);
  for (let i = 0; i < 50; i++) {
    assert.ok(!rollRewards(run, data.attacks).some((r) => r.type === 'prime'));
  }
  assert.throws(() => applyReward(run, offer));
});

test('a character holds at most 3 attacks', () => {
  const run = newRun(character('Rook'), ['punch', 'jab']);
  applyReward(run, { type: 'learn', name: 'kick' });
  assert.equal(run.attacks.length, 3);
  assert.throws(() => applyReward(run, { type: 'learn', name: 'bite' }));
  applyReward(run, { type: 'learn', name: 'bite' }, 0);
  assert.deepEqual(run.attacks.map((a) => a.name), ['bite', 'jab', 'kick']);
});

test('strength adds damage and stamina is spent', () => {
  const { battle } = battleBetween('Rook', 'Bulwark');
  battle.enemy.attacks = [];
  const before = battle.enemy.hp;
  const stamina = battle.player.stamina;
  runTurn(battle, { type: 'attack', index: 0 }, hitNoCrit());
  assert.equal(before - battle.enemy.hp, 2 + 4); // punch 2 + floor(9 / 2)
  assert.equal(battle.player.stamina, stamina - 2 + 1); // cost, then end-of-turn regen
});

test('a stun skips one action, then the target cannot be stunned again right away', () => {
  const { battle } = battleBetween('Wren', 'Rook');
  battle.player.attacks = [attackAtLevel(attack('punch'), PRIME_LEVEL)];
  battle.player.stamina = battle.player.maxStamina = 50;
  battle.enemy.attacks = [];
  battle.enemy.hp = battle.enemy.maxHp = 500;

  const first = runTurn(battle, { type: 'attack', index: 0 }, hitNoCrit());
  assert.ok(first.some((e) => e.type === 'stunned' && e.actor === 'enemy'));

  battle.player.primeSpent = false; // Prime is once per battle; this test is only about stuns.
  const second = runTurn(battle, { type: 'attack', index: 0 }, hitNoCrit());
  assert.ok(!second.some((e) => e.type === 'stunned'));
  assert.equal(battle.enemy.stunned, false);

  battle.player.primeSpent = false;
  const third = runTurn(battle, { type: 'attack', index: 0 }, hitNoCrit());
  assert.ok(third.some((e) => e.type === 'stunned'));
});

// Rook with Prime Punch and Lv 3 Punch, against a harmless target with plenty of HP.
function primeBattle(enemyName) {
  const run = newRun(character('Rook'), ['punch', 'jab']);
  run.attacks[0].level = PRIME_LEVEL;
  run.primeUsed = true;
  const battle = startBattle(run, character(enemyName), data.attacks);
  battle.enemy.attacks = [];
  battle.enemy.hp = battle.enemy.maxHp = 500;
  battle.enemy.bonusDamage = 0;
  return battle;
}
const PRIME_INDEX = 1; // The list is [Punch Lv 3, Punch Prime, Jab].

test('prime works once per battle, resets next battle, and level 3 stays usable', () => {
  const battle = primeBattle('Bulwark');
  runTurn(battle, { type: 'attack', index: PRIME_INDEX }, hitNoCrit());
  assert.equal(canUseAttack(battle.player, battle.player.attacks[PRIME_INDEX]), false);
  assert.throws(() => runTurn(battle, { type: 'attack', index: PRIME_INDEX }));
  assert.equal(canUseAttack(battle.player, battle.player.attacks[0]), true);
  assert.equal(primeBattle('Bulwark').player.primeSpent, false);
});

test('a missed prime is still spent, but being stunned does not spend it', () => {
  const missed = primeBattle('Bulwark');
  runTurn(missed, { type: 'attack', index: PRIME_INDEX }, () => 0.999);
  assert.equal(missed.player.primeSpent, true);

  const stunned = primeBattle('Bulwark');
  stunned.player.stunned = true;
  runTurn(stunned, { type: 'attack', index: PRIME_INDEX }, hitNoCrit());
  assert.equal(stunned.player.primeSpent, false);
});

test('prime hits harder when the target just rested, whoever moves first', () => {
  // No rest yet: Prime Punch is (5 + 4 strength) per hit, twice.
  const fresh = primeBattle('Bulwark');
  runTurn(fresh, { type: 'attack', index: PRIME_INDEX }, hitNoCrit());
  assert.equal(500 - fresh.enemy.hp, 18);

  // Player is faster: the enemy's rest from last turn still counts.
  const faster = primeBattle('Bulwark');
  runTurn(faster, { type: 'rest' }, hitNoCrit());
  assert.equal(playerPrimeBonusReady(faster), true);
  runTurn(faster, { type: 'attack', index: PRIME_INDEX }, hitNoCrit());
  assert.equal(500 - faster.enemy.hp, 14 * 2);

  // Player is slower: the enemy rests earlier in this same turn.
  const slower = primeBattle('Wren');
  assert.equal(playerPrimeBonusReady(slower), false);
  runTurn(slower, { type: 'attack', index: PRIME_INDEX }, hitNoCrit());
  assert.equal(500 - slower.enemy.hp, 14 * 2);
});

test('level 3 gets no bonus, and neither does a target that attacked after resting', () => {
  const level3 = primeBattle('Bulwark');
  runTurn(level3, { type: 'rest' }, hitNoCrit());
  runTurn(level3, { type: 'attack', index: 0 }, hitNoCrit());
  assert.equal(500 - level3.enemy.hp, 8);

  const moved = primeBattle('Bulwark');
  moved.enemy.lastAction = 'attack';
  runTurn(moved, { type: 'attack', index: PRIME_INDEX }, hitNoCrit());
  assert.equal(500 - moved.enemy.hp, 18);
});

test('an alpha uses its prime on a resting player, only once', () => {
  const run = newRun(character('Rook'), ['punch', 'jab']);
  run.wave = 5;
  const battle = startBattle(run, character('Wren'), data.attacks); // Wren acts first
  battle.player.lastAction = 'rest';
  const prime = battle.enemy.attacks.find((a) => a.level === PRIME_LEVEL);
  const events = runTurn(battle, { type: 'attack', index: 0 });
  assert.ok(events.some((e) => e.text === `Alpha Wren uses Prime ${prime.name}!`));
  assert.equal(battle.enemy.primeSpent, true);
  assert.notEqual(chooseEnemyAction(battle.enemy, { lastAction: 'rest' }, () => 0).index, 2);
});

test('shield absorbs damage before HP', () => {
  const { battle } = battleBetween('Rook', 'Bulwark');
  battle.enemy.attacks = [];
  battle.enemy.shield = 4;
  const before = battle.enemy.hp;
  runTurn(battle, { type: 'attack', index: 0 }, hitNoCrit());
  assert.equal(battle.enemy.shield, 0);
  assert.equal(before - battle.enemy.hp, 2);
});

test('passives: iron hide, spines and bloodthirst', () => {
  const iron = battleBetween('Rook', 'Ironclad').battle;
  iron.enemy.attacks = [];
  const ironBefore = iron.enemy.hp;
  runTurn(iron, { type: 'attack', index: 0 }, hitNoCrit());
  assert.equal(ironBefore - iron.enemy.hp, 5);

  const spines = battleBetween('Rook', 'Nettle').battle;
  spines.enemy.attacks = [];
  const hpBefore = spines.player.hp;
  runTurn(spines, { type: 'attack', index: 0 }, hitNoCrit());
  assert.equal(hpBefore - spines.player.hp, 2);

  const leech = battleBetween('Leech', 'Rook').battle;
  leech.player.hp = 5;
  leech.enemy.attacks = [];
  runTurn(leech, { type: 'attack', index: 0 }, hitNoCrit());
  assert.equal(leech.player.hp, 5 + 1); // 25% of 4 damage
});

test('a killing blow ends the battle before the loser can act', () => {
  const { battle } = battleBetween('Rook', 'Wren');
  battle.player.stats.a = 10;
  battle.enemy.hp = 1;
  battle.enemy.attacks = [];
  const hpBefore = battle.player.hp;
  const events = runTurn(battle, { type: 'attack', index: 0 }, hitNoCrit());
  assert.equal(battle.winner, 'player');
  assert.equal(battle.player.hp, hpBefore);
  assert.equal(events.at(-1).type, 'faint');
});

test('exhaustion ends a battle that regen would otherwise stall', () => {
  const { battle } = battleBetween('Moss', 'Moss');
  battle.player.attacks = [];
  battle.enemy.attacks = [];
  while (!battle.winner) {
    assert.ok(battle.turn < 100, 'battle must end');
    runTurn(battle, { type: 'rest' });
  }
  assert.equal(battle.winner, 'player'); // Equal HP: the enemy drops first.
});

test('winning carries HP over, heals by charisma and advances the wave', () => {
  const { run, battle } = battleBetween('Doc Hale', 'Rook');
  battle.player.hp = 10;
  const { healed, bonusReward } = finishBattle(run, battle, () => 0);
  assert.equal(healed, Math.ceil(maxHp(run.stats) * (20 + 7 * 2) / 100));
  assert.equal(run.hp, 10 + healed);
  assert.equal(run.wave, 2);
  assert.equal(bonusReward, true);
});

test('rewards always offer choices, even with everything maxed', () => {
  const run = newRun(character('Rook'), ['punch', 'jab', 'kick']);
  run.attacks.forEach((a) => { a.level = 3; });
  run.primeUsed = true;
  Object.keys(run.stats).forEach((k) => { run.stats[k] = 10; });
  run.hp = maxHp(run.stats);
  assert.equal(rollRewards(run, data.attacks).length, 4); // Perception 10 adds a fourth option
  run.stats.p = 9;
  assert.equal(rollRewards(run, data.attacks).length, 3);
});

test('equipment loads with numeric effects and rarities', () => {
  assert.ok(data.equipment.length >= 5);
  assert.equal(data.equipment[0].name, 'helmet');
  assert.equal(data.equipment[0].dodgeChance, 2);
  assert.deepEqual(validateEquipment(data.equipment), []);
  assert.ok(validateEquipment([{ name: 'X', rarity: 'mythic', startRoundShild: 0, dodgeChance: 0, damageReduction: 0, maxHealthBonus: 0 }]).length >= 2);
});

test('equipment: one piece at a time, effects apply in battle', () => {
  const run = newRun(character('Rook'), ['punch', 'bite']);
  const base = runMaxHp(run);
  const helmet = data.equipment.find((g) => g.name === 'helmet');
  const plate = data.equipment.find((g) => g.name === 'Titan Plate');
  equipGear(run, plate);
  assert.equal(runMaxHp(run), base + 20);
  assert.equal(run.hp, base + 20);
  assert.equal(equipGear(run, helmet), plate); // Swapping returns the old piece and replaces it
  assert.equal(runMaxHp(run), base);
  assert.ok(run.hp >= 1 && run.hp <= base);
  const battle = startBattle(run, character('Rook'), data.attacks);
  runTurn(battle, { type: 'rest' });
  assert.ok(battle.player.shield <= 3);
});

test('equipment drops follow the drop chance', () => {
  assert.equal(rollEquipmentDrop(data.equipment, () => 0.99), null);
  assert.ok(rollEquipmentDrop(data.equipment, () => 0));
  assert.equal(rollEquipmentDrop([], () => 0), null);
});

test('full simulated runs always finish without errors', () => {
  for (let i = 0; i < 200; i++) {
    const c = data.characters[i % data.characters.length];
    const run = newRun(c, ['punch', 'bite']);
    while (run.wave < 200) {
      const battle = startBattle(run, data.characters[(i + run.wave) % data.characters.length], data.attacks);
      for (let turn = 0; !battle.winner; turn++) {
        assert.ok(turn < 2000, 'battle must end');
        const usable = battle.player.attacks.findIndex((a) => canUseAttack(battle.player, a));
        runTurn(battle, usable >= 0 ? { type: 'attack', index: usable } : { type: 'rest' });
      }
      if (battle.winner === 'enemy') break;
      finishBattle(run, battle);
      const rewards = rollRewards(run, data.attacks);
      assert.ok(rewards.length > 0);
      const reward = rewards[0];
      applyReward(run, reward, reward.type === 'learn' && run.attacks.length >= 3 ? 0 : null);
      assert.ok(run.attacks.length <= 3);
      assert.ok(run.attacks.filter((a) => a.level === PRIME_LEVEL).length <= 1);
    }
  }
});
