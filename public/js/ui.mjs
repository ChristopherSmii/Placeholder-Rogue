import {
  SPECIAL, STAT_INFO, RULES, MAX_ATTACKS, PRIME_LEVEL,
  maxHp, runMaxHp, gearBonuses, rollEquipmentDrop, equipGear, maxStamina, attackAtLevel, levelLabel, hitChance,
  newRun, startBattle, pickWildCharacter, runTurn, finishBattle, rollRewards, applyReward,
  boostedStats, normalizeProfile, ownedCount, addToInventory, buyItem, consumeItems,
  awardRunPoints, rollAlphaDrop, killsInRun, canUseAttack, playerPrimeBonusReady,
} from './engine.mjs';

const app = document.getElementById('app');
const BEST_KEY = 'doodleRogue.bestWave';
const PROFILE_KEY = 'doodleRogue.profile';
const EVENT_DELAY = 650;
const STARTING_ATTACKS = 2;

let data;
let run;
let battle;
let keyHandler = null;
let bestAtRunStart = 0; // The best score is saved mid-run, so game over compares against this.
let profile = loadProfile();

// --- Small helpers ---

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') el.className = value;
    else if (value === true) el.setAttribute(key, '');
    else if (value !== false && value != null) el.setAttribute(key, value);
  }
  el.append(...children.flat(Infinity).filter((child) => child != null));
  return el;
}

function show(...nodes) {
  setKeys(null);
  app.replaceChildren(...nodes.filter((node) => node != null));
  window.scrollTo(0, 0);
}

function setKeys(handler) {
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = handler;
  if (handler) document.addEventListener('keydown', handler);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const titleCase = (text) => text.replace(/\b\w/g, (c) => c.toUpperCase());
const attackDef = (name) => data.attacks.find((def) => def.name === name);

function readBest() {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
}

function saveBest(wave) {
  try { if (wave > readBest()) localStorage.setItem(BEST_KEY, String(wave)); } catch { /* best score is optional */ }
}

function loadProfile() {
  try { return normalizeProfile(JSON.parse(localStorage.getItem(PROFILE_KEY))); } catch { return normalizeProfile(null); }
}

function saveProfile() {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch { /* lasts until the page closes */ }
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const heldLabel = (attack) => (attack.level === PRIME_LEVEL ? 'Prime + Lv 3' : levelLabel(attack.level));
const inventoryTotal = () => Object.values(profile.inventory).reduce((sum, count) => sum + count, 0);

function statBadge(stat) {
  return h('span', { class: 'stat-badge', title: STAT_INFO[stat].name }, stat.toUpperCase());
}

function primeTraits(prime) {
  const traits = [];
  if (prime.timesHit > 1) traits.push(`hits ${prime.timesHit}×`);
  if (prime.lifeSteal > 0) traits.push(`${prime.lifeSteal}% lifesteal`);
  if (prime.addedShield > 0) traits.push(`+${prime.addedShield} shield`);
  if (prime.stun) traits.push('stuns');
  return traits.join(', ');
}

function statBars(stats, base = stats) {
  return h('dl', { class: 'stats' }, SPECIAL.map((key) => [
    h('dt', { title: STAT_INFO[key].name }, key.toUpperCase()),
    h('dd', {},
      h('span', { class: 'pips', 'aria-hidden': 'true' },
        Array.from({ length: RULES.statCap }, (_, i) => h('i', {
          class: i < base[key] ? 'on' : i < stats[key] ? 'on gained' : '',
        }))),
      h('b', {}, String(stats[key]))),
  ]));
}

function statLegend() {
  return h('ul', { class: 'legend' }, SPECIAL.map((key) => h('li', {},
    h('b', {}, `${key.toUpperCase()} `), `${STAT_INFO[key].name}: ${STAT_INFO[key].effect}`)));
}

function passiveNote(passive) {
  return passive
    ? h('p', { class: 'passive' }, h('b', {}, passive.name), ` ${passive.description}`)
    : null;
}

// --- Step 1: choose a character ---

// Selecting updates the page in place: rebuilding it would make every portrait blink.
function renderSelect(initial = data.characters[0]) {
  const best = readBest();
  let selected = initial;

  const cards = data.characters.map((character) => h('button', {
    class: 'char-card',
    onClick: () => select(character),
  },
    h('img', { src: character.picture, alt: '' }),
    h('span', { class: 'char-name' }, character.name),
    character.passive ? h('span', { class: 'tag' }, character.passive.name) : null));

  const portrait = h('img', { alt: '' });
  const name = h('h2');
  const summary = h('p', { class: 'muted' });
  const sheet = h('div', { class: 'details-body' });

  const select = (character) => {
    selected = character;
    data.characters.forEach((other, i) => {
      cards[i].classList.toggle('selected', other === character);
      cards[i].setAttribute('aria-pressed', String(other === character));
    });
    if (portrait.getAttribute('src') !== character.picture) portrait.src = character.picture;
    name.textContent = character.name;
    summary.textContent = `${maxHp(character.stats)} HP · ${maxStamina(character.stats)} stamina`;
    sheet.replaceChildren(...[passiveNote(character.passive), statBars(character.stats)].filter(Boolean));
  };

  show(
    h('header', { class: 'title' },
      h('h1', {}, 'Placeholder Rogue'),
      h('p', {}, 'Pick a fighter. Beat whatever wanders in. See how far you get.'),
      best ? h('p', { class: 'best' }, `Best run: reached wave ${best}`) : null,
      h('div', { class: 'profile-bar' },
        h('span', {}, `${plural(profile.points, 'point')} · ${plural(inventoryTotal(), 'item')}`),
        h('button', { class: 'shop-link', onClick: () => renderShop(() => renderSelect(selected)) }, 'Shop & inventory'))),
    h('div', { class: 'select-layout' },
      h('section', { class: 'char-grid', 'aria-label': 'Characters' }, cards),
      h('aside', { class: 'sheet details' },
        h('div', { class: 'details-head' }, portrait, h('div', {}, name, summary)),
        sheet,
        h('button', { class: 'primary', onClick: () => renderAttackPicker(selected) }, 'Choose attacks →'),
        h('details', {}, h('summary', {}, 'What do the stats do?'), statLegend()))),
  );
  select(selected);
}

// --- Shop and inventory ---

function renderShop(back) {
  const points = h('p', { class: 'shop-points' });
  const inventory = h('div', { class: 'inventory' });

  const rows = data.items.map((item) => {
    const owned = h('span', { class: 'muted' });
    const buy = h('button', {
      class: 'buy',
      onClick: () => {
        buyItem(profile, item);
        saveProfile();
        refresh();
      },
    });
    return {
      item,
      owned,
      buy,
      el: h('article', { class: 'sheet shop-item' },
        statBadge(item.stat),
        h('div', { class: 'item-text' },
          h('h2', {}, item.name),
          h('p', {}, `+1 ${STAT_INFO[item.stat].name} for one run. `, h('span', { class: 'muted' }, item.description)),
          owned),
        buy),
    };
  });

  const refresh = () => {
    points.textContent = `You have ${plural(profile.points, 'point')}.`;
    for (const { item, owned, buy } of rows) {
      owned.textContent = `Owned: ${ownedCount(profile, item.name)}`;
      buy.textContent = `Buy · ${plural(item.price, 'pt')}`;
      buy.disabled = profile.points < item.price;
    }
    const held = data.items.filter((item) => ownedCount(profile, item.name) > 0);
    inventory.replaceChildren(held.length
      ? h('ul', {}, held.map((item) => h('li', {}, statBadge(item.stat), ` ${item.name} × ${ownedCount(profile, item.name)}`)))
      : h('p', { class: 'muted' }, 'Empty. Buy something here, or beat Alphas for a slim chance at a drop.'));
  };

  show(
    h('header', { class: 'title small' },
      h('button', { class: 'link', onClick: back }, '← Back'),
      h('h1', {}, 'Shop'),
      points,
      h('p', { class: 'muted' }, 'You earn 1 point per kill when a run ends.')),
    h('section', { class: 'shop-list', 'aria-label': 'Items for sale' }, rows.map((row) => row.el)),
    h('section', { class: 'sheet inventory-panel' },
      h('h2', {}, 'Inventory'),
      inventory,
      h('p', { class: 'muted' }, 'Consume items when you start a run. Their boost lasts for that run only.')),
  );
  refresh();
}

// --- Step 3: consume items, then start the run ---

function startRun(character, attackNames, consumed = []) {
  consumeItems(profile, consumed);
  saveProfile();
  bestAtRunStart = readBest();
  run = newRun(character, attackNames, consumed);
  nextBattle();
}

function renderItemPicker(character, attackNames) {
  const owned = data.items.filter((item) => ownedCount(profile, item.name) > 0);
  const uses = new Map(owned.map((item) => [item, 0]));
  const preview = h('div');
  const consumed = () => owned.flatMap((item) => Array(uses.get(item)).fill(item));

  const rows = owned.map((item) => {
    const count = h('b', { class: 'stepper-count' });
    const change = (delta) => {
      uses.set(item, uses.get(item) + delta);
      refresh();
    };
    const minus = h('button', { class: 'step', 'aria-label': `Use one less ${item.name}`, onClick: () => change(-1) }, '−');
    const plus = h('button', { class: 'step', 'aria-label': `Use one more ${item.name}`, onClick: () => change(1) }, '+');
    return {
      item,
      count,
      minus,
      plus,
      el: h('article', { class: 'sheet shop-item' },
        statBadge(item.stat),
        h('div', { class: 'item-text' },
          h('h2', {}, item.name),
          h('p', {}, `+1 ${STAT_INFO[item.stat].name}. You own ${ownedCount(profile, item.name)}.`)),
        h('div', { class: 'stepper' }, minus, count, plus)),
    };
  });

  const refresh = () => {
    const stats = boostedStats(character, consumed());
    for (const { item, count, minus, plus } of rows) {
      count.textContent = String(uses.get(item));
      minus.disabled = uses.get(item) === 0;
      plus.disabled = uses.get(item) >= ownedCount(profile, item.name) || stats[item.stat] >= RULES.statCap;
    }
    preview.replaceChildren(
      h('p', { class: 'muted' }, `${maxHp(stats)} HP · ${maxStamina(stats)} stamina`),
      statBars(stats, character.stats));
  };

  show(
    h('header', { class: 'title small' },
      h('button', { class: 'link', onClick: () => renderAttackPicker(character, attackNames) }, '← Back'),
      h('h1', {}, 'Use items?'),
      h('p', {}, `Consumed items boost ${character.name} for this run only, and are used up even if you lose quickly.`)),
    h('div', { class: 'select-layout' },
      h('section', { class: 'shop-list single', 'aria-label': 'Your items' }, rows.map((row) => row.el)),
      h('aside', { class: 'sheet details' },
        h('h2', {}, character.name),
        preview,
        h('button', { class: 'primary', onClick: () => startRun(character, attackNames, consumed()) }, 'Start run →'))),
  );
  refresh();
}

// --- Step 2: choose starting attacks ---

function renderAttackPicker(character, chosen = []) {
  const toggle = (name) => {
    if (chosen.includes(name)) renderAttackPicker(character, chosen.filter((n) => n !== name));
    else if (chosen.length < STARTING_ATTACKS) renderAttackPicker(character, [...chosen, name]);
  };

  const row = (def) => {
    const isChosen = chosen.includes(def.name);
    const levels = [1, 2, 3].map((level) => attackAtLevel(def, level).damage).join(' / ');
    return h('button', {
      class: `attack-option${isChosen ? ' selected' : ''}`,
      'aria-pressed': isChosen ? 'true' : 'false',
      disabled: !isChosen && chosen.length >= STARTING_ATTACKS,
      onClick: () => toggle(def.name),
    },
      h('span', { class: 'attack-name' }, titleCase(def.name)),
      h('span', { class: 'attack-meta' }, `Damage ${levels} · costs ${def.staminaCost} stamina`),
      h('span', { class: 'attack-prime' }, `Prime: ${attackAtLevel(def, PRIME_LEVEL).damage} damage, ${primeTraits(def.prime) || 'no extras'}`));
  };

  show(
    h('header', { class: 'title small' },
      h('button', { class: 'link', onClick: () => renderSelect(character) }, '← Back'),
      h('h1', {}, `${character.name}'s attacks`),
      h('p', {}, `Pick ${STARTING_ATTACKS} to start with. You can hold ${MAX_ATTACKS}, and learn or upgrade more as you win.`)),
    h('section', { class: 'attack-list' }, data.attacks.map(row)),
    h('div', { class: 'sticky-action' },
      h('button', {
        class: 'primary',
        disabled: chosen.length !== STARTING_ATTACKS,
        onClick: () => {
          if (inventoryTotal() > 0) renderItemPicker(character, chosen);
          else startRun(character, chosen);
        },
      }, chosen.length !== STARTING_ATTACKS
        ? `Choose ${STARTING_ATTACKS - chosen.length} more`
        : inventoryTotal() > 0 ? 'Next: items →' : 'Start run →')),
  );
}

// --- Battle ---

function nextBattle() {
  battle = startBattle(run, pickWildCharacter(data.characters), data.attacks);
  renderBattle();
}

function bar(kind, label) {
  const fill = h('span', { class: 'fill' });
  const value = h('span', { class: 'bar-value' });
  return {
    fill,
    value,
    el: h('div', { class: `bar ${kind}` },
      h('span', { class: 'bar-label' }, label),
      h('span', { class: 'track' }, fill),
      value),
  };
}

function fighterPanel(fighter) {
  const hp = bar('hp', 'HP');
  const stamina = bar('stamina', 'ST');
  const badges = h('span', { class: 'badges' });
  const picture = h('img', { src: fighter.picture, alt: fighter.name, class: 'fighter-img' });
  const stage = h('div', { class: `stage ${fighter.side}` }, picture);
  const enemyPrime = fighter.side === 'enemy' ? fighter.attacks.find((attack) => attack.level === PRIME_LEVEL) : null;

  const panel = h('div', { class: `sheet status ${fighter.side}${fighter.isAlpha ? ' alpha' : ''}` },
    h('div', { class: 'status-head' },
      h('h2', {}, fighter.name),
      badges),
    hp.el,
    stamina.el,
    passiveNote(fighter.character.passive));

  return {
    panel,
    stage,
    picture,
    update({ hp: hpNow, maxHp: hpMax, stamina: stNow, maxStamina: stMax, shield, stunned, primeSpent }) {
      const ratio = hpNow / hpMax;
      hp.fill.style.width = `${ratio * 100}%`;
      hp.fill.classList.toggle('low', ratio <= 0.25);
      hp.value.textContent = `${hpNow}/${hpMax}`;
      stamina.fill.style.width = `${(stNow / stMax) * 100}%`;
      stamina.value.textContent = `${stNow}/${stMax}`;
      badges.replaceChildren(...[
        shield > 0 ? h('span', { class: 'badge shield' }, `Shield ${shield}`) : null,
        stunned ? h('span', { class: 'badge stun' }, 'Stunned') : null,
        enemyPrime ? h('span', { class: `badge prime${primeSpent ? ' spent' : ''}` },
          primeSpent ? 'Prime used' : `Prime ${titleCase(enemyPrime.name)}`) : null,
      ].filter(Boolean));
    },
  };
}

function floatText(view, text, kind) {
  const float = h('span', { class: `float ${kind}`, 'aria-hidden': 'true' }, text);
  view.stage.append(float);
  float.addEventListener('animationend', () => float.remove());
}

function replayClass(el, name) {
  el.classList.remove(name);
  void el.offsetWidth; // Restarts the CSS animation.
  el.classList.add(name);
}

function renderBattle() {
  const views = { player: fighterPanel(battle.player), enemy: fighterPanel(battle.enemy) };
  const log = h('div', { class: 'log', role: 'log', 'aria-live': 'polite' });
  const menu = h('div', { class: 'menu' });
  const surrenderBar = h('div', { class: 'surrender' });

  const say = (text) => {
    log.append(h('p', {}, text));
    while (log.children.length > 30) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  };

  const syncAll = (state) => {
    views.player.update(state.player);
    views.enemy.update(state.enemy);
  };

  const playEvent = (event) => {
    if (event.text) say(event.text);
    syncAll(event.state);
    const target = event.target && views[event.target];
    switch (event.type) {
      case 'hit':
        replayClass(target.picture, 'shake');
        floatText(target, `-${event.amount}${event.crit ? '!' : ''}`, event.crit ? 'crit' : 'damage');
        break;
      case 'miss': floatText(target, 'miss', 'miss'); break;
      case 'heal': floatText(target, `+${event.amount}`, 'heal'); break;
      case 'shield': floatText(target, `+${event.amount}`, 'shield'); break;
      case 'stun': floatText(target, 'stun!', 'crit'); break;
      case 'use': replayClass(views[event.actor].picture, event.actor === 'player' ? 'lunge-right' : 'lunge-left'); break;
      case 'faint': target.picture.classList.add('fainted'); break;
      default: break;
    }
  };

  const act = async (action) => {
    setKeys(null);
    drawMenu(true);
    const events = runTurn(battle, action);
    for (const event of events) {
      playEvent(event);
      if (event.type !== 'tick') await sleep(EVENT_DELAY);
    }
    if (battle.winner === 'player') renderVictory();
    else if (battle.winner === 'enemy') renderGameOver();
    else drawMenu(false);
  };

  const drawSurrender = (locked, confirming = false) => {
    if (!confirming) {
      surrenderBar.replaceChildren(h('button', {
        class: 'link',
        disabled: locked,
        onClick: () => drawSurrender(false, true),
      }, 'Surrender'));
      return;
    }
    const earned = killsInRun(run);
    surrenderBar.replaceChildren(
      h('span', {}, `End this run and bank ${plural(earned, 'point')}?`),
      h('button', { class: 'confirm', onClick: () => renderGameOver(true) }, 'Yes, surrender'),
      h('button', { class: 'confirm', onClick: () => drawSurrender(false) }, 'Keep fighting'));
  };

  const drawMenu = (locked) => {
    drawSurrender(locked);
    const me = battle.player;
    const bonusReady = playerPrimeBonusReady(battle);
    const buttons = me.attacks.map((attack, index) => {
      const isPrime = attack.level === PRIME_LEVEL;
      const spent = isPrime && me.primeSpent;
      const boosted = isPrime && !spent && bonusReady;
      const baseDamage = attack.damage + Math.floor(me.stats.s / RULES.strengthPerDamage);
      const damage = boosted ? Math.ceil(baseDamage * RULES.primeAfterRestMultiplier) : baseDamage;
      const bonusPercent = Math.round((RULES.primeAfterRestMultiplier - 1) * 100);
      const traits = [primeTraits(attack), spent ? 'used this battle' : 'once per battle'].filter(Boolean).join(', ');
      return h('button', {
        class: `move${isPrime ? ' prime' : ''}${boosted ? ' boosted' : ''}`,
        disabled: locked || !canUseAttack(me, attack),
        onClick: () => act({ type: 'attack', index }),
      },
        h('span', { class: 'move-name' }, h('kbd', {}, String(index + 1)), titleCase(attack.name)),
        h('span', { class: 'move-level' }, levelLabel(attack.level)),
        h('span', { class: 'move-meta' },
          `${damage} dmg · ${attack.staminaCost} stamina · ${hitChance(me.stats, battle.enemy.stats, battle.enemy.gear.dodge)}% hit`),
        isPrime ? h('span', { class: 'move-traits' }, traits) : null,
        isPrime && !spent ? h('span', { class: 'move-traits' }, boosted
          ? `Enemy just rested: +${bonusPercent}% damage!`
          : `+${bonusPercent}% damage if the enemy just rested`) : null);
    });
    const rest = h('button', {
      class: 'move rest',
      disabled: locked,
      onClick: () => act({ type: 'rest' }),
    },
      h('span', { class: 'move-name' }, h('kbd', {}, 'R'), 'Rest'),
      h('span', { class: 'move-meta' }, `Recover ${Math.ceil(me.maxStamina / 2)} stamina`));
    menu.replaceChildren(...buttons, rest);

    if (!locked) {
      setKeys((e) => {
        if (e.key.toLowerCase() === 'r') act({ type: 'rest' });
        const attack = me.attacks[Number(e.key) - 1];
        if (attack && canUseAttack(me, attack)) act({ type: 'attack', index: Number(e.key) - 1 });
      });
    }
  };

  show(
    h('header', { class: 'battle-top' },
      h('span', { class: 'wave' }, `Wave ${run.wave}`),
      h('span', { class: 'muted' }, battle.enemy.isAlpha ? 'An alpha blocks the way!' : `Best: ${readBest() || '–'}`)),
    h('section', { class: 'arena' },
      views.enemy.panel, views.enemy.stage,
      views.player.stage, views.player.panel),
    log,
    menu,
    surrenderBar,
  );

  syncAll({ player: battle.player, enemy: battle.enemy });
  say(`${battle.enemy.name} appears!`);
  const fasterName = battle.player.stats.a >= battle.enemy.stats.a ? battle.player.name : battle.enemy.name;
  say(`${fasterName} is quicker and will act first.`);
  drawMenu(false);
}

// --- Rewards ---

function describeReward(reward) {
  switch (reward.type) {
    case 'prime': {
      const prime = attackAtLevel(attackDef(reward.name), PRIME_LEVEL);
      return {
        kicker: 'Only one per run',
        title: `Prime ${titleCase(reward.name)}`,
        body: `${prime.damage} damage, ${primeTraits(prime) || 'no extras'}. Costs ${prime.staminaCost} stamina. Usable once per battle, and you keep the Lv 3 version too.`,
      };
    }
    case 'upgrade': {
      const before = attackAtLevel(attackDef(reward.name), reward.level - 1);
      const after = attackAtLevel(attackDef(reward.name), reward.level);
      return {
        kicker: 'Upgrade',
        title: `${titleCase(reward.name)} to Lv ${reward.level}`,
        body: `Base damage ${before.damage} → ${after.damage}.`,
      };
    }
    case 'learn': {
      const def = attackDef(reward.name);
      return {
        kicker: 'New attack',
        title: `Learn ${titleCase(reward.name)}`,
        body: `${def.startingDamage} base damage, costs ${def.staminaCost} stamina.`,
      };
    }
    case 'stat':
      return {
        kicker: 'Training',
        title: `+1 ${STAT_INFO[reward.stat].name}`,
        body: `${STAT_INFO[reward.stat].effect}. Now ${run.stats[reward.stat]} → ${run.stats[reward.stat] + 1}.`,
      };
    default:
      return {
        kicker: 'Camp',
        title: 'Patch up',
        body: `Recover ${RULES.healRewardPercent}% of your max HP. You're at ${run.hp}/${runMaxHp(run)}.`,
      };
  }
}

function gearSummary(gear) {
  const bonus = gearBonuses(gear);
  const parts = [];
  if (bonus.shield) parts.push(`+${bonus.shield} shield each round`);
  if (bonus.dodge) parts.push(`-${bonus.dodge}% enemy hit chance`);
  if (bonus.reduction) parts.push(`-${bonus.reduction} damage taken`);
  if (bonus.hp) parts.push(`+${bonus.hp} max HP`);
  return parts.join(' · ');
}

const gearLabel = (gear) => (gear ? `${titleCase(gear.name)} (${gear.rarity})` : 'nothing');

function renderVictory() {
  const beaten = battle.enemy.name;
  const { healed, bonusReward } = finishBattle(run, battle);
  saveBest(run.wave);
  const lines = [`You beat ${beaten}.`];
  if (healed > 0) lines.push(`You recover ${healed} HP.`);
  const drop = rollAlphaDrop(battle.enemy, data.items);
  if (drop) {
    addToInventory(profile, drop.name);
    saveProfile();
    lines.push(`It dropped: ${drop.name}! It's in your inventory.`);
  }
  const gear = rollEquipmentDrop(data.equipment);
  if (gear) lines.push(`It dropped equipment: ${titleCase(gear.name)}!`);
  renderRewards(lines.join(' '), bonusReward ? 2 : 1, gear);
}

function renderRewards(intro, picksLeft, foundGear = null) {
  const rewards = rollRewards(run, data.attacks);

  const claim = (reward, replaceIndex) => {
    applyReward(run, reward, replaceIndex);
    if (picksLeft > 1) renderRewards('Your Intelligence earns a second reward.', picksLeft - 1, foundGear);
    else nextBattle();
  };

  const choose = (reward) => {
    if (reward.type === 'learn' && run.attacks.length >= MAX_ATTACKS) renderForget(reward, () => renderRewardCards());
    else claim(reward, null);
  };

  const renderForget = (reward, back) => {
    show(
      h('header', { class: 'title small' },
        h('button', { class: 'link', onClick: back }, '← Choose another reward'),
        h('h1', {}, `Learn ${titleCase(reward.name)}?`),
        h('p', {}, `You can hold ${MAX_ATTACKS} attacks. Pick one to forget. If you forget a Prime attack, you won't get another this run.`)),
      h('section', { class: 'attack-list' }, run.attacks.map((attack, index) => h('button', {
        class: 'attack-option',
        onClick: () => claim(reward, index),
      },
        h('span', { class: 'attack-name' }, `Forget ${titleCase(attack.name)}`),
        h('span', { class: 'attack-meta' }, heldLabel(attack))))),
    );
  };

  const renderRewardCards = () => {
    show(
      h('header', { class: 'title small' },
        h('h1', {}, 'Wave cleared!'),
        h('p', {}, intro),
        h('p', { class: 'muted' }, `HP ${run.hp}/${runMaxHp(run)} · Next: wave ${run.wave}`)),
      foundGear ? h('section', { class: 'sheet gear-found' },
        h('h2', {}, `Found: ${gearLabel(foundGear)}`),
        h('p', {}, gearSummary(foundGear)),
        h('p', { class: 'muted' }, run.equipment
          ? `You wear ${gearLabel(run.equipment)}. Equipping swaps it out and the old one is lost.`
          : 'You are not wearing any equipment.'),
        h('div', { class: 'gear-actions' },
          h('button', { onClick: () => { equipGear(run, foundGear); foundGear = null; renderRewardCards(); } }, 'Equip'),
          h('button', { class: 'link', onClick: () => { foundGear = null; renderRewardCards(); } }, 'Leave it'))) : null,
      h('section', { class: 'reward-list' }, rewards.map((reward) => {
        const { kicker, title, body } = describeReward(reward);
        return h('button', { class: `reward ${reward.type}`, onClick: () => choose(reward) },
          h('span', { class: 'reward-kicker' }, kicker),
          h('span', { class: 'reward-title' }, title),
          h('span', { class: 'reward-body' }, body));
      })),
      h('button', { class: 'link', onClick: () => nextBattle() }, picksLeft > 1 ? 'Skip rewards' : 'Skip reward'),
      h('section', { class: 'sheet loadout' },
        h('h2', {}, 'Your attacks'),
        h('ul', {}, run.attacks.map((attack) => h('li', {}, `${titleCase(attack.name)} (${heldLabel(attack)})`))),
        h('p', { class: 'muted' }, run.equipment ? `Wearing: ${gearLabel(run.equipment)} — ${gearSummary(run.equipment)}` : 'Wearing: nothing'),
        statBars(run.stats, run.character.stats)),
    );
  };

  renderRewardCards();
}

// --- Game over ---

function renderGameOver(surrendered = false) {
  saveBest(run.wave);
  const isRecord = run.wave > bestAtRunStart;
  const cleared = run.wave - 1;
  const earned = awardRunPoints(profile, run);
  saveProfile();

  show(
    h('section', { class: 'sheet gameover' },
      h('img', { src: run.character.picture, alt: '', class: 'fainted' }),
      h('h1', {}, 'Run over'),
      h('p', {}, `${run.character.name} ${surrendered ? 'surrendered to' : 'fell to'} ${battle.enemy.name} on wave ${run.wave}, after clearing ${cleared} ${cleared === 1 ? 'wave' : 'waves'}.`),
      isRecord ? h('p', { class: 'best' }, 'New best run!') : h('p', { class: 'muted' }, `Best run: reached wave ${bestAtRunStart}`),
      h('p', { class: 'earned' }, `+${plural(earned, 'point')} for ${plural(earned, 'kill')}. You now have ${profile.points}.`),
      h('ul', {}, run.attacks.map((attack) => h('li', {}, `${titleCase(attack.name)} (${heldLabel(attack)})`))),
      h('button', { class: 'primary', onClick: () => renderSelect(run.character) }, 'Try again')),
  );
}

// --- Start ---

try {
  const response = await fetch('/api/game-data');
  if (!response.ok) throw new Error(`Server replied ${response.status}`);
  data = await response.json();
  renderSelect();
} catch (error) {
  show(h('p', { class: 'loading' }, `Couldn't load the game data: ${error.message}`));
}
