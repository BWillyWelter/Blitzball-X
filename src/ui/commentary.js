/**
 * Poolside-announcer commentary lines, keyed by sim events. Picked with the sim RNG so
 * headless tests don't diverge from the browser build. Voice: two loud-ass street casters
 * talking trash over a pickup run at the cage.
 */
const LINES = {
  goal: [
    'OH SHIT! {p} just BURIED that thang!',
    'GOOOOAL! {p} done cooked the whole defense, my boy!',
    '{p} put that shit on a PLATTER! It\'s in!',
    'TOP BINS, BABY! {p} showed ZERO respect for that keeper!',
    '{p} let that mufucka FLY and it\'s IN! Ayy!',
  ],
  goal_long: [
    'FROM DOWNTOWN?! {p} you dirty bastard, THAT\'S A BUCKET!',
    'NAH he did NOT just shoot from there — {p} with the DAMN SCREAMER!',
    '{p} dropped that from the moon and it still went IN! That\'s disrespectful!',
  ],
  goal_volley: [
    'OFF THE LOB — {p} SMASHED that shit! GOAL!',
    '{p} met it in the AIR and DEMOLISHED it! Get him a stretcher for that net!',
    'ACROBATIC! {p} out here doing flips and shit — it\'s IN!',
  ],
  goal_perfect: [
    'PERFECT strike from {p}! Keeper ain\'t even MOVE, that\'s embarrassing!',
    '{p} hit a laser so filthy they gotta wash the goal. DAMN.',
  ],
  save: [
    '{k} said NOT TODAY, get that shit OUTTA here!',
    'Big ass save from {k}! Hands like glue, my boy!',
    '{k} got a FINGERTIP on it! Sheesh!',
    'DENIED! {k} standing on BUSINESS today!',
  ],
  save_big: [
    'WHAT THE FUCK, {k}! Save of the YEAR outta nowhere!',
    '{k} is a GODDAMN WALL! Ain\'t nothing getting past him!',
    'FULL STRETCH! {k} just robbed dude BLIND! Sick!',
  ],
  washed: [
    '{v} got WASHED! {p} had him spinning like a washing machine, damn!',
    'OH HELL NO! {v} going in CIRCLES! {p} is NASTY with it!',
    '{p} put {v} in the rinse cycle! Somebody check on him!',
    '{v} shaking right now! {p} broke his ANKLES in the water, cold-blooded!',
  ],
  tackle: [
    '{p} snatched his chain! PICKPOCKET!',
    'STRIPPED! {p} took that shit like it was HIS!',
    '{p} with the sticky ass hands! That\'s a felony!',
    'Turnover! {p} read that pass like a bedtime story.',
  ],
  block: [
    'DENIED! {p} put his whole BODY on the line!',
    '{p} said ain\'t SHIT getting through! Get that outta here!',
    'WALL MEET BALL! {p} with the rejection, no refund!',
  ],
  alleyoop: [
    '{a} threw it UP... {p} put that shit on a TEE! DAMN!',
    'LOB CITY BITCH! {a} to {p} in the AIR!',
    '{a} floated it, {p} VAN GOGH\'d it! That\'s art!',
  ],
  gamebreaker: [
    'GAMEBREAKER! {p} about to ruin somebody\'s WHOLE night!',
    'OH IT\'S BAD! {p} got the GAMEBREAKER and he\'s HUNGRY!',
    'IT\'S OVER! Pack it up! {p} got the GAMEBREAKER!',
  ],
  gbscore: [
    'GAMEBREAKER GOAL! Points for {t} AND took some off the board! That\'s ROBBERY!',
    'DEVASTATING! {p} just flipped this whole match, cold as ICE!',
  ],
  miss: [
    '{p} couldn\'t hit water if he fell out the boat, damn!',
    'Off the ring! {p} gon\' lose sleep over that one!',
    'WIDE! {p} what the hell was that, cuz?!',
    'SKIED IT! {p} put that shit in the STANDS!',
  ],
  post: [
    'OFF THE RING! {p} was THIS damn close! Sheesh!',
    'CLANG! {p} rattled that thing like a tip jar!',
  ],
  heating: [
    '{p} is HEATING UP and it\'s a PROBLEM!',
    '{t} on a RAMPAGE right now! Somebody call the FIRE department!',
    'Don\'t leave {p} open! That man is COOKING!',
  ],
  bighit: [
    'BOOM! {p} just sent {v} to the SHADOW REALM!',
    'No blood, no foul! {p} laid the WOOD on {v}!',
    '{p} said GET OFF ME! {v} felt that in his SOUL!',
    'DAMN! {v} just got flattened! That\'s a hit you HEAR!',
  ],
  turnover_clock: [
    'BEEP BEEP! {t} was out here sightseeing, clock caught \'em!',
    'TOO SLOW! {t} stood around and LOST that shit!',
  ],
  keeperhold: ['Bro the keeper\'s cradling that thing like a BABY — LET IT GO!'],
  win: [
    '{t} WINS THE WHOLE THING! DROP the confetti!',
    'THAT\'S THE MATCH, BABY! {t} ran the pool!',
    'And STILL! {t} the baddest in the water!',
  ],
  blowout: [
    '{t} out here running a CLINIC! This shit getting UGLY!',
    'Somebody get a MERCY RULE! {t} up big and still bullying!',
  ],
  tip: [
    'It\'s a sold-out cage! {h} versus {aw} — most goals WIN, no excuses!',
    'LET\'S RUN IT! {h} taking on {aw} in the sphere tonight!',
  ],
  trick: [
    '{p} pulled the {tr} out the BAG! Ohhh!',
    'AYY, {tr} from {p}! That was NASTY, my boy!',
    '{p} showing off now! {tr} in a live game?! DISRESPECTFUL!',
  ],
  combo: [
    '{p} is COOKING! Combo x{c}! Leave the man alone!',
    '{p} will NOT stop! Combo x{c}! He\'s HIM!',
  ],
  halftime: [
    'That\'s the half! {h} {s0}, {aw} {s1}. Somebody\'s getting chewed out in the locker room.',
    'Halftime! {h} {s0} — {aw} {s1}. Second half boutta be WAR.',
  ],
  overtime: [
    'We\'re LEVEL! OVERTIME — next goal WINS it all, no cowards allowed!',
    'GOLDEN GOAL, BABY! One shot decides EVERYTHING! Let\'s goooo!',
  ],
  mercy: ['MERCY RULE! {t} ended they ass EARLY! Have some shame!'],
};

const first = (p) => (p && p.data ? p.data.nick || p.data.name.split(' ')[0] : '');

export class Commentary {
  constructor(sim, onLine) {
    this.sim = sim;
    this.onLine = onLine;
    this.last = -10;
    this.lastKey = '';
    this.bind();
  }

  say(key, ctx = {}, force = false, priority = 1) {
    const pool = LINES[key];
    if (!pool) return;
    const now = this.sim.time;
    if (!force && now - this.last < 1.6 && priority < 2) return;
    let line = pool[Math.floor(this.sim.rng.next() * pool.length)];
    line = line
      .replace('{p}', first(ctx.p))
      .replace('{v}', first(ctx.v))
      .replace('{a}', first(ctx.a))
      .replace('{k}', first(ctx.k))
      .replace('{t}', ctx.t || '')
      .replace('{h}', ctx.h || '')
      .replace('{aw}', ctx.aw || '')
      .replace('{s0}', ctx.s0 ?? '')
      .replace('{s1}', ctx.s1 ?? '')
      .replace('{tr}', ctx.tr || '')
      .replace('{c}', ctx.c || '');
    this.last = now;
    this.lastKey = key;
    this.onLine(line, priority);
  }

  teamName(t) {
    return `${this.sim.teams[t].city} ${this.sim.teams[t].name}`;
  }

  bind() {
    const ev = this.sim.events;
    const sim = this.sim;
    ev.on('live', () => {
      if (sim.time < 2.5) this.say('tip', { h: this.teamName(0), aw: this.teamName(1) }, true, 2);
    });
    ev.on('score', ({ player, type, gb, team, score }) => {
      if (gb) return this.say('gbscore', { p: player, t: this.teamName(team) }, true, 3);
      if (type === 'volley') this.say('goal_volley', { p: player }, true, 2);
      else if (type === 'long') this.say('goal_long', { p: player }, true, 2);
      else this.say('goal', { p: player }, true, 2);
      const opp = score[1 - team];
      const mine = score[team];
      if (mine - opp >= 5 && mine % 3 === 0) setTimeout(() => this.say('blowout', { t: this.teamName(team) }, false, 1), 1200);
    });
    ev.on('save', ({ keeper, big }) => this.say(big ? 'save_big' : 'save', { k: keeper }, big, 2));
    ev.on('washed', ({ player, victim }) => this.say('washed', { p: player, v: victim }, true, 2));
    ev.on('tackle', ({ player }) => this.say('tackle', { p: player }, false, 2));
    ev.on('block', ({ blocker }) => this.say('block', { p: blocker }, true, 2));
    ev.on('alleyoop', ({ passer, finisher }) => this.say('alleyoop', { a: passer, p: finisher }, true, 3));
    ev.on('gamebreaker', ({ player }) => this.say('gamebreaker', { p: player }, true, 3));
    ev.on('miss', ({ player, type }) => {
      if (type === 'post') this.say('post', { p: player }, false, 1);
      else if (type !== 'blocked' && sim.rng.chance(0.35)) this.say('miss', { p: player }, false, 1);
    });
    ev.on('heating', ({ player, team }) => this.say('heating', { p: player, t: this.teamName(team) }, true, 2));
    ev.on('bighit', ({ player, victim }) => this.say('bighit', { p: player, v: victim }, false, 1));
    ev.on('turnover', ({ team, reason }) => {
      if (reason === 'POSSESSION CLOCK') this.say('turnover_clock', { t: this.teamName(team) }, true, 2);
    });
    ev.on('violation', ({ reason }) => {
      if (reason === 'KEEPER HOLD') this.say('keeperhold', {}, false, 1);
    });
    ev.on('trick', ({ player, name }) => {
      if (player.combo >= 3) this.say('combo', { p: player, c: player.combo }, false, 1);
      else if (sim.rng.chance(0.25)) this.say('trick', { p: player, tr: name.toLowerCase() }, false, 1);
    });
    ev.on('halftime', ({ score }) => this.say('halftime', { h: this.teamName(0), aw: this.teamName(1), s0: score[0], s1: score[1] }, true, 3));
    ev.on('overtime', () => this.say('overtime', {}, true, 3));
    ev.on('gameover', ({ winner, score }) => {
      if (Math.abs(score[0] - score[1]) >= sim.rules.mercyLead) this.say('mercy', { t: this.teamName(winner) }, true, 3);
      else this.say('win', { t: this.teamName(winner) }, true, 3);
    });
  }
}
