const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./harness');

function base(ev) {
  ev("ACT.start({});S.cash=1e8;for(const g of GOALS)S.done[g.id]=0;ACT.launchBB({city:'fra'})");
}

test('#4 several transits in one city share the load instead of filling one by one', () => {
  const { ev, errors } = load();
  base(ev);
  ev("ACT.buyTransit({city:'fra',net:'cog',tier:1});ACT.buyTransit({city:'fra',net:'lvl',tier:1});compute()");
  const u = JSON.parse(ev("JSON.stringify(S.transit.map(t=>R.useT[t.id]||0))"));
  assert.equal(u.length, 2);
  assert.ok(u[0] > 0 && u[1] > 0, `both carry traffic (${u})`);
  assert.ok(Math.abs(u[0] - u[1]) / (u[0] + u[1]) < 0.35, `roughly balanced (${u})`);
  // local exits still win over far ones: a transit in London is not used while Frankfurt has room
  ev("ACT.buildPop({city:'lon'});UI.via=null;openLinkModal('fra','lon');ACT.buildLink({tier:3});closeModal();ACT.buyTransit({city:'lon',net:'tly',tier:1});compute()");
  assert.equal(ev("R.useT[S.transit.find(t=>t.city==='lon').id]||0"), 0, 'remote transit stays idle');
  // backup-only still means backup only
  ev("S.transit[1].pref='low';compute()");
  assert.equal(ev("R.useT[S.transit[1].id]||0"), 0);
  assert.deepEqual(errors, []);
});

test('#5 export writes a file and import restores it, with checks', () => {
  const { ev, dom, errors } = load();
  const window = dom.window;
  base(ev);
  ev("S.name='Export Me';S.cash=1234567;compute()");
  let blobText = null;
  window.URL.createObjectURL = b => { blobText = b; return 'blob:x'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { window.__dl = this.download; };
  ev("ACT.exportSave()");
  assert.match(window.__dl, /^series-of-tubes-export-me-\d{4}-\d\d-\d\d\.json$/);
  const txt = ev("JSON.stringify({app:'series-of-tubes',version:APP_VERSION,S})");
  assert.ok(blobText);
  ev("S.cash=1;S.name='Other'");
  assert.match(ev(`parseSave('{"nope":1}').err`), /does not look/);
  assert.match(ev(`parseSave('not json').err`), /not valid JSON/);
  assert.match(ev(`parseSave(JSON.stringify(Object.assign(JSON.parse(${JSON.stringify(txt)}).S,{lost:true}))).err`), /bankrupt/);
  ev(`UI.importing=parseSave(${JSON.stringify(txt)}).s;ACT.importGo()`);
  assert.equal(ev("S.name"), 'Export Me');
  assert.equal(ev("S.cash"), 1234567);
  assert.equal(ev("JSON.parse(localStorage.getItem('sot-save-v1')).name"), 'Export Me', 'saved on this device');
  ev("showHelp()");
  assert.match(ev("document.getElementById('modalCard').textContent"), /Export save.*Import a save/);
  assert.deepEqual(errors, []);
});

test('#6 full transit, IX, caches and routers show up in the NOC and on the map', () => {
  const { ev, errors } = load();
  base(ev);
  ev("S.pops.fra.bb.d=5000;ACT.buyTransit({city:'fra',net:'cog',tier:0});ACT.buyIx({city:'ams',tier:0,signed:true});S.caches.push({id:'cx',city:'fra',net:'akm'});compute()");
  ev("R.nodeLoad.fra=R.nodeCap.fra;UI.hotMap=hotByCity()");
  const ks = JSON.parse(ev("JSON.stringify(hotPorts().map(h=>h.k))"));
  for (const k of ['t', 'c', 'r']) assert.ok(ks.includes(k), `${k} is reported hot (${ks})`);
  assert.ok(ev("UI.hotMap.fra&&UI.hotMap.fra.t>=0.9"));
  ev("ACT.leftTab({t:'noc'})");  // NOC reads R as it is now (router forced hot above)
  const noc = ev("document.getElementById('leftBody')?document.getElementById('leftBody').textContent:document.body.textContent");
  assert.match(noc, /running hot/);
  assert.match(noc, /Akamai AANP cache/);
  assert.match(noc, /transit/);
  ev("draw&&draw(performance.now())");
  assert.deepEqual(errors, []);
});

test('some routers take forever to boot, PacketOinkers most of all', () => {
  const { ev, errors } = load();
  base(ev);
  const pct = JSON.parse(ev("JSON.stringify(RG.map((G,g)=>{let n=0;for(const c of ALLC){S.pops[c]=S.pops[c]||{rgen:g,routers:1};S.pops[c].rgen=g;if(slowBoot(c))n++;}return n/ALLC.length;}))"));
  assert.ok(pct[0] < pct[2] && pct[2] > 0.2 && pct[0] < 0.3, `bigger chassis are slow more often (${pct})`);
  assert.match(ev("RG[2].chip"), /PacketOinker/);
  // find a slow and a fast POP and crash them
  ev("for(const c of ALLC)if(c!=='fra')delete S.pops[c];S.pops.fra.rgen=2;S.pops.fra.routers=1");
  const slowCity = ev("ALLC.find(c=>{S.pops[c]={rgen:2,routers:1,down:0};const s=slowBoot(c);if(!s)delete S.pops[c];return s;})");
  ev(`for(const c of Object.keys(S.pops))if(c!=='${slowCity}')delete S.pops[c];S.transit=[];S.ixp={};for(let i=0;i<800&&!S.inc.some(x=>x.type==='crash');i++){fireFailure();S.inc=S.inc.filter(x=>x.type==='crash');}`);
  const inc = JSON.parse(ev("JSON.stringify(S.inc.find(i=>i.type==='crash'))"));
  assert.ok(inc.slow, 'crash on a slow booter is flagged');
  assert.ok(inc.until - ev('S.day') >= 4, 'and lasts longer');
  ev(`S.cash=1e6;ACT.fixInc({id:'${inc.id}'})`);
  assert.equal(ev(`S.inc.find(i=>i.id==='${inc.id}').until`), ev('S.day+1'), 'rushing it still takes a day');
  ev(`selectCity('${slowCity}');ACT.tab({t:'infra'})`);
  assert.match(ev("document.getElementById('panelBody').textContent"), /a slow one/);
  assert.deepEqual(errors, []);
});

test('the network name opens a menu with save, load and start over', () => {
  const { ev, errors } = load();
  base(ev);
  ev("document.querySelector('[data-act=menu]').click()");
  const t = ev("document.getElementById('modalCard').textContent");
  for (const w of ['Export save', 'Import a save', 'Start a new network', 'Back to the map']) assert.ok(t.includes(w), w);
  ev("document.querySelector('#modalCard [data-act=resetAsk]').click()");
  assert.match(ev("document.getElementById('modalCard').textContent"), /cannot be undone/);
  ev("document.querySelector('#modalCard [data-act=newgame]').click()");
  assert.equal(ev("!!localStorage.getItem('sot-save-v1')&&JSON.parse(localStorage.getItem('sot-save-v1')).day>0"), false);
  assert.deepEqual(errors, []);
});

test('a rare global outage shows a banner, dents traffic and only happens once', () => {
  const { ev, errors } = load();
  base(ev);
  ev("compute()");const before = ev("R.demand");
  ev("elephant();compute();renderAll()");
  assert.ok(ev("R.demand") < before * 0.8);
  assert.equal(ev("document.getElementById('mega').hidden"), false);
  for (let i = 0; i < 5; i++) ev("dayTick()");
  ev("renderAll()");
  assert.equal(ev("document.getElementById('mega').hidden"), true);
  assert.equal(ev("S.phpDone"), true);
  assert.deepEqual(errors, []);
});

test('badges unlock with a rarity, persist across games, and secret ones stay hidden', () => {
  const { ev, errors } = load();
  base(ev);
  ev("localStorage.removeItem('sot-badges');S.ach={};compute();checkGoals();ACT.leftTab({t:'goals'})");
  let txt = ev("document.body.textContent");
  assert.match(txt, /Badges/);
  assert.match(txt, /\?\?\?/, 'secret badges are hidden');
  ev("ACT.buyIx({city:'fra',tier:1,signed:true});ACT.rs({city:'fra'});compute();checkGoals()");
  assert.ok(ev("S.ach.hello!==undefined"), 'first peering badge');
  assert.ok(ev("!!JSON.parse(localStorage.getItem('sot-badges')).hello"), 'remembered across games');
  ev("S.stats.sharks=3;checkGoals()");
  assert.ok(ev("S.ach.bait!==undefined&&S.ach.shark!==undefined"));
  ev("ACT.leftTab({t:'goals'})");
  txt = ev("document.body.textContent");
  assert.match(txt, /Legendary/);
  assert.equal(ev("GOALS.some(g=>g.id==='gi')&&GOALS.some(g=>g.id==='t10')"), true);
  assert.equal(ev("document.getElementById('hBank').className"), 'badge');
  assert.deepEqual(errors, []);
});

test('Auto-TE spills overflow onto an alternate path when the shortest one is full', () => {
  const { ev, errors } = load();
  ev("ACT.start({});S.cash=1e9;S.lvl=4;for(const g of GOALS)S.done[g.id]=0;ACT.launchBB({city:'fra'})");
  ev("for(const c of ['ams','lon','par'])ACT.buildPop({city:c});const L=(a,b,t,v)=>{UI.via=v||null;openLinkModal(a,b);ACT.buildLink({tier:t});closeModal();};L('fra','ams',0);L('ams','lon',1,'uly');L('fra','par',1);L('par','lon',1,'chn');ACT.buyTransit({city:'lon',net:'lvl',tier:1});compute()");
  const dem = ev("R.demand");
  assert.ok(ev("R.served") < dem - 1, 'without TE the 10G link caps it');
  ev("ACT.buyTE();compute()");
  assert.ok(ev("R.served") > dem * 0.97, 'with TE nearly everything is served');
  assert.ok(ev("R.teMoved") > 1);
  assert.ok(ev("R.load[S.links.find(l=>l.a==='fra'&&l.b==='par').id]") > 1, 'the Paris path carries the overflow');
  ev("ACT.leftTab({t:'noc'})");
  assert.match(ev("document.body.textContent"), /Auto-TE/);
  ev("ACT.teToggle();compute()");
  assert.ok(ev("R.served") < dem - 1, 'switching it off goes back to shortest path only');
  assert.deepEqual(errors, []);
});

test('rare badges hook into incidents and deals', () => {
  const { ev, errors } = load();
  base(ev);
  ev("addInc({type:'cut',ref:'x',until:S.day+1,msg:'A crocodile took a bite. A ship dragged its anchor.'});checkGoals()");
  assert.ok(ev("S.ach.croc!==undefined&&S.ach.anchor!==undefined&&S.ach.backhoe!==undefined"));
  ev("S.stats.survived=100;checkGoals()");
  assert.ok(ev("S.ach.unbreak!==undefined"));
  assert.equal(ev("BADGES.length>=46&&new Set(BADGES.map(b=>b.id)).size===BADGES.length"), true);
  assert.deepEqual(errors, []);
});

test('#7 NOC legend, sortable network table and transit destinations', () => {
  const { ev, errors } = load();
  base(ev);
  ev("ACT.buyTransit({city:'fra',net:'cog',tier:1});compute();ACT.dash();ACT.dashTab({k:'traffic'})");
  let t = ev("document.getElementById('dashCard').textContent");
  assert.match(t, /Who your transit carries/);
  assert.match(t, /IX peering/, 'legend explains the colours');
  const top = JSON.parse(ev("JSON.stringify(transitTop(S.transit.map(t=>t.id),3))"));
  assert.ok(top.length > 0 && top[0][1] > 0);
  assert.equal(ev(`typeof offTransitHint('${top[0][0]}','fra')`), 'string');
  ev("ACT.dashSort({k:'cost'})");
  assert.equal(ev("UI.dashSort"), 'cost');
  ev("ACT.dashSort({k:'cost'})");
  assert.equal(ev("UI.dashDir"), 1, 'second tap flips the order');
  ev("selectCity('fra');ACT.tab({t:'up'})");
  assert.match(ev("document.getElementById('panelBody').textContent"), /Top destinations on this port/);
  assert.deepEqual(errors, []);
});

test('#11 pausing freezes the dots on the links', () => {
  const { ev, errors } = load();
  base(ev);
  ev("ACT.animSet({v:'on'});UI.speed=1;last=1000;frame(1016)");
  const t0 = ev("animT");
  ev("UI.speed=0;frame(1100);frame(1400)");
  assert.equal(ev("animT"), t0, 'clock stands still while paused');
  ev("UI.speed=1;frame(1416)");
  assert.ok(ev("animT") > t0, 'and moves again on play');
  assert.deepEqual(errors, []);
});

test('#16 shark-averse customers only ask for routes that can stay on land', () => {
  const { ev, errors } = load();
  ev("ACT.start({});S.cash=1e9;S.lvl=4;for(const g of GOALS)S.done[g.id]=0");
  ev("for(const c of ['ams','lon','nyc','ash','chi','sjc','sin','tok','syd','sao','jnb','bom','par','mad'])ACT.buildPop({city:c})");
  let shark = 0, bad = [];
  for (let i = 0; i < 1500; i++) {
    const o = JSON.parse(ev("S.offers=[];spawnOffer();JSON.stringify(S.offers.filter(o=>(o.reqs||[]).includes('sharks')).map(o=>[o.city,o.city2]))"));
    for (const [a, b] of o) { shark++; if (ev(`CITY['${a}'].land!==CITY['${b}'].land`)) bad.push(a + '-' + b); }
  }
  assert.ok(shark > 0, 'the requirement still shows up');
  assert.deepEqual(bad, [], 'never across an ocean');
  // old saves: an impossible ask is dropped, a possible one stays
  const s = ev("JSON.stringify(Object.assign(JSON.parse(JSON.stringify(S)),{offers:[{id:'o1',type:'l2vpn',city:'nyc',city2:'lon',name:'x',bw:10,rate:1,reqs:['sharks','gen'],exp:S.day+9},{id:'o2',type:'l2vpn',city:'nyc',city2:'chi',name:'y',bw:10,rate:1,reqs:['sharks'],exp:S.day+9}]}))");
  const m = JSON.parse(ev(`JSON.stringify(migrate(${s}).offers.map(o=>o.reqs))`));
  assert.deepEqual(m, [['gen'], ['sharks']]);
  assert.deepEqual(errors, []);
});

test('#28 scenic routing stays put, and splits over two equally quiet paths', () => {
  const { ev, errors } = load();
  ev("ACT.start({});S.cash=1e9;S.lvl=4;for(const g of GOALS)S.done[g.id]=0;ACT.launchBB({city:'fra'})");
  ev("for(const c of ['ams','lon','par'])ACT.buildPop({city:c});const L=(a,b,t,v)=>{UI.via=v||null;openLinkModal(a,b);ACT.buildLink({tier:t});closeModal();};L('fra','ams',1);L('ams','lon',1,'uly');L('fra','par',1);L('par','lon',1,'chn')");
  ev("S.biz.push({id:'bulk1',type:'bulk',name:'Sloth Sync',city:'fra',city2:'lon',bw:60,rate:1000,reqs:[],route:'scenic',mood:100,start:S.day});compute()");
  const loads = () => JSON.parse(ev("JSON.stringify(['fra|par','ams|fra'].map(k=>Math.round((R.ef[k]&&R.ef[k].eg['l2:bulk1'])||0)))"));
  const seen = [];
  for (let d = 0; d < 6; d++) { ev('compute()'); seen.push(loads().join('/')); }
  assert.equal(new Set(seen).size, 1, `no flapping day to day (${seen})`);
  const [viaPar, viaAms] = loads();
  assert.ok(viaPar > 0 && viaAms > 0, `both quiet paths carry it (${viaPar}/${viaAms})`);
  assert.equal(ev("R.l2['bulk1']"), 60, 'the whole circuit is delivered');
  ev("selectCity('fra');ACT.tab({t:'cust'})");
  assert.deepEqual(errors, []);
});

test('#17 #30 very long dark fiber runs in long-haul mode, and regen sites bring full speed back', () => {
  const { ev, errors } = load();
  ev("ACT.start({});S.cash=1e9;S.lvl=4;for(const g of GOALS)S.done[g.id]=0;ACT.launchBB({city:'fra'})");
  // a 4,500+ km terrestrial dark fiber with a ROADM, like the one in #30
  ev("ACT.buildPop({city:'mos'});S.links.push({id:'lf',a:'lis',b:'mos',kind:'df',km:4551,sys:'roadm',ch:[],ready:0,mo:1000,day:0,cut:0});ACT.buildPop({city:'lis'});S.pops.lis.rgen=3;S.pops.mos.rgen=3;compute()");
  assert.equal(ev("chWhy(S.links.find(l=>l.id==='lf'),'tp16')"), '', 'the transponder fits now');
  ev("ACT.addCh({id:'lf',o:'tp16'});compute()");
  assert.equal(ev("dfCap(S.links.find(l=>l.id==='lf'))"), 800, 'long-haul mode: 800G per channel');
  ev("ACT.regen({id:'lf',d:1});compute()");
  const l = "S.links.find(l=>l.id==='lf')";
  assert.equal(ev(`${l}.regen`), 1);
  assert.equal(ev(`spanKm(${l})`), 2276);
  assert.equal(ev(`dfCap(${l})`), 1600, 'one regen site: full 1.6T again');
  assert.ok(ev("R.cost.optical") >= ev("REGEN_MO"), 'regen huts cost rent');
  assert.match(ev("chWhy({km:20000,regen:0,sys:'roadm',ch:[],a:'lis',b:'mos'},'zr4')"), /regen site/, 'hopeless spans say what to do');
  // removing a regen site that optics still need is refused
  ev("S.links.find(l=>l.id==='lf').km=15000;ACT.regen({id:'lf',d:-1})");
  assert.equal(ev(`${l}.regen`), 1);
  ev("ACT.selLink({id:'lf'})");
  assert.match(ev("document.getElementById('panelBody').textContent"), /Regen sites/);
  assert.deepEqual(errors, []);
});

test('LACP trouble, partial packet loss and PMTUD black holes fire, hurt and clear', () => {
  const { ev, errors } = load();
  ev("ACT.start({});S.cash=1e9;S.lvl=4;for(const g of GOALS)S.done[g.id]=0;ACT.launchBB({city:'fra'})");
  ev("ACT.buildPop({city:'ams'});UI.via=null;openLinkModal('fra','ams');ACT.buildLink({tier:1});closeModal();ACT.buyTransit({city:'fra',net:'cog',tier:1});ACT.lagT({id:S.transit[0].id,d:1});ACT.buyIx({city:'ams',tier:1});ACT.lagIx({city:'ams',d:1});S.day=100;compute()");
  const src = ev('fireFailure.toString()').replace(/^function fireFailure/, 'function').replace('let tot=opts.reduce', "opts.splice(0,opts.length,['funny',1]);let tot=opts.reduce");
  const fire = (t) => { ev('window.__ff=' + src.replace('type=pick(f);}', `type='${t}';}`)); ev('__ff();compute()'); };
  for (let i = 0; i < 12; i++) { fire('lacp'); }
  assert.ok(ev("S.inc.some(i=>i.type==='lacp')"), 'LACP incidents fire');
  assert.ok(ev("S.transit[0].lacp||S.ev.ixlacp"), 'a LAG is degraded');
  fire('loss');
  const l = "S.links.find(l=>l.loss)";
  if (ev(`!!${l}`)) assert.ok(ev(`capOf(${l})<LT[${l}.tier].g`), 'loss cuts goodput');
  const dem = ev('R.served');
  fire('pmtud');
  assert.ok(ev("!!S.ev.pmtud&&S.inc.some(i=>i.type==='pmtud')"));
  assert.ok(ev('R.served') <= dem + 1e-6, 'some traffic never completes');
  for (const t of ['lacp', 'loss', 'pmtud']) assert.notEqual(ev(`incTitle('${t}')`), 'Incident');
  ev("for(const i of S.inc.slice())clearInc(i);compute()");
  assert.equal(ev("!!(S.transit[0].lacp||S.ev.pmtud||S.links.some(l=>l.loss)||(S.ev.ixlacp&&Object.keys(S.ev.ixlacp).length))"), false, 'everything clears');
  assert.deepEqual(errors, []);
});

test('an optical control plane meltdown darkens every leased wave in a region, not your own fiber', () => {
  const { ev, errors } = load();
  ev("ACT.start({});S.cash=1e9;S.lvl=4;for(const g of GOALS)S.done[g.id]=0;ACT.launchBB({city:'fra'})");
  ev("for(const c of ['ams','par','ber'])ACT.buildPop({city:c});const L=(a,b)=>{UI.via=null;openLinkModal(a,b);ACT.buildLink({tier:1});closeModal();};L('fra','ams');L('fra','par');L('fra','ber');S.links.push({id:'dfx',a:'ams',b:'ber',kind:'df',km:580,sys:'lite',ch:['zr4'],ready:0,mo:500,day:0,cut:0});S.day=120;compute()");
  const src = ev('fireEvent.toString()').replace(/^function fireEvent/, 'function').replace('const e=pick(opts);', "const e='ctrlplane';");
  ev('window.__fe=' + src + ';__fe();compute()');
  assert.equal(ev("S.links.filter(l=>l.kind==='wave').every(l=>linkDown(l))"), true, 'all leased waves in Europe are dark');
  assert.equal(ev("linkDown(S.links.find(l=>l.id==='dfx'))"), false, 'own dark fiber keeps working');
  const inc = "S.inc.find(i=>i.type==='ctrlplane')";
  assert.ok(ev(`${inc}.cost>0`));
  ev(`ACT.fixInc({id:${inc}.id});compute()`);
  assert.equal(ev("S.links.filter(l=>l.kind==='wave').some(l=>linkDown(l))"), false, 'escalating brings them back');
  assert.deepEqual(errors, []);
});

test('decommissioning POPs, one or several, removes what is there and charges for the customers', () => {
  const { ev, errors } = load();
  ev("ACT.start({});S.cash=1e8;S.lvl=4;for(const g of GOALS)S.done[g.id]=0;ACT.launchBB({city:'fra'})");
  ev("for(const c of ['ams','par','lon'])ACT.buildPop({city:c});const L=(a,b)=>{UI.via=null;openLinkModal(a,b);ACT.buildLink({tier:1});closeModal();};L('fra','ams');L('fra','par');L('ams','lon');ACT.buyTransit({city:'ams',net:'cog',tier:1});ACT.buyIx({city:'ams',tier:1});ACT.peerAll({city:'ams'});compute()");
  ev("S.biz.push({id:'b1',type:'l2vpn',name:'Tulip Bank',city:'ams',city2:'fra',bw:10,rate:300,reqs:[],mood:100,start:S.day},{id:'b2',type:'l2vpn',name:'Croissant Co',city:'par',city2:'fra',bw:5,rate:200,reqs:[],mood:100,start:S.day})");
  ev("selectCity('ams');ACT.tab({t:'infra'})");
  assert.match(ev("document.getElementById('panelBody').textContent"), /Decommission/);
  ev("ACT.decomOpen({city:'ams'})");
  assert.match(ev("document.getElementById('modalCard').textContent"), /Tulip Bank/);
  const cash = ev('S.cash');
  ev("ACT.decomToggle({city:'lon'});ACT.decomGo();compute()");
  assert.equal(ev("!!S.pops.ams||!!S.pops.lon"), false, 'both gone');
  assert.equal(ev("S.links.some(l=>[l.a,l.b].some(c=>c==='ams'||c==='lon'))"), false);
  assert.equal(ev("S.transit.length+Object.keys(S.ixp).length"), 0, 'ports and exchange go with them');
  assert.equal(ev("S.biz.map(b=>b.id).join()"), 'b2', 'only the Amsterdam customer is let go');
  assert.equal(cash - ev('S.cash'), 10 * 300 * 3, 'three months of the contract');
  // never the last one
  ev("ACT.decomOpen({});for(const c of Object.keys(S.pops))ACT.decomToggle({city:c});ACT.decomGo()");
  assert.ok(ev("Object.keys(S.pops).length") >= 1);
  assert.deepEqual(errors, []);
});

test('#19 parallel waves draw as one line, dark fiber can add parallel links, NLNOG Day exists', () => {
  const { ev, errors } = load();
  ev("ACT.start({});S.cash=1e9;S.lvl=4;for(const g of GOALS)S.done[g.id]=0;ACT.launchBB({city:'fra'});ACT.buildPop({city:'nyc'});ACT.buildPop({city:'lon'})");
  ev("for(let i=0;i<4;i++){UI.via='grace';UI.route='same';openLinkModal('nyc','lon');ACT.buildLink({tier:1});closeModal();}compute()");
  assert.equal(ev("S.links.length"), 4);
  assert.equal(ev("linkGroups().length"), 1, 'four waves on one cable are one line');
  assert.match(ev("groupLabel(linkGroups()[0],linkGroups()[0])"), /^4×/);
  ev("S.links.push({id:'dfp',a:'fra',b:'lon',kind:'df',km:640,sys:'lite',ch:['zr4'],ready:0,mo:500,day:0,cut:0});ACT.selLink({id:'dfp'})");
  assert.match(ev("document.getElementById('panelBody').textContent"), /Add parallel link/);
  assert.ok(ev("CONFS.some(c=>c.n==='NLNOG Day'&&c.c==='ams')"));
  ev("cam.z=0.4;draw(0);cam.z=2;draw(0)");
  assert.deepEqual(errors, []);
});

test('#40 overland between continents costs ten times subsea or more, and has no dark fiber', () => {
  const { ev, errors } = load();
  base(ev);
  const r = JSON.parse(ev(`JSON.stringify(CABLE_PAIRS.filter(c=>landX(c.a,c.b)).map(c=>{
    const land=waveMo(kmBetween(c.a,c.b),false,2)*landMult(c.a,c.b)*waveMarket(c.a,c.b,false).m;
    const sub=waveMo(c.km,true,2)*CAB[c.cid].price*waveMarket(c.a,c.b,true).m;return [land/sub,!!(CITY[c.a].land2||CITY[c.b].land2)];}))`));
  assert.ok(r.length >= 4, 'Europe–Asia cable routes exist to compare');
  // Across a land bridge (Cairo, #47) the cable goes the long way round Arabia, so overland is "only" 4–9× dearer.
  for (const [x, bridge] of r) assert.ok(x >= (bridge ? 4 : 10), `overland is at least ${bridge ? 4 : 10}× subsea (${x.toFixed(1)})`);
  assert.equal(ev("landX('mrs','hkg')"), true);
  assert.equal(ev("landX('fra','mrs')"), false, 'inside Europe stays normal');
  assert.equal(ev("landMult('fra','mrs')"), 1);
  assert.equal(ev("dfAllowed('ist','dxb')"), false, 'no dark fiber pair across a dozen borders');
  assert.equal(ev("dfAllowed('fra','mrs')"), true);
  assert.deepEqual(errors, []);
});

test('#39 caches are limited by router ports, not by a fixed count', () => {
  const { ev, errors } = load();
  base(ev);
  ev("for(let i=0;i<5;i++){R.demTo.nfx=1e4;ACT.cache({city:'fra',net:'nfx'});}");
  assert.equal(ev("S.caches.filter(x=>x.city==='fra'&&x.net==='nfx').length"), 5, 'a fifth box is fine');
  // fill every remaining port: the next box is refused
  ev("const p=S.pops.fra;while(portsUsed('fra')<portsMax('fra'))S.caches.push({id:uid(),city:'fra',net:'nfx'});window.__n=S.caches.length;R.demTo.nfx=1e4;ACT.cache({city:'fra',net:'nfx'})");
  assert.equal(ev("S.caches.length"), ev("window.__n"), 'no free port, no box');
  assert.deepEqual(errors, []);
});

test('#31 #33 #38 connections overview lists every port, filters it and jumps to it', () => {
  const { ev, dom, errors } = load();
  base(ev);
  const doc = dom.window.document;
  ev("ACT.buildPop({city:'ams'});S.pops.fra.rgen=S.pops.ams.rgen=RG.length-1;S.pops.ams.bb={d:200};compute()");
  ev("ACT.buyTransit({city:'fra',net:'cog',tier:1});ACT.buyTransit({city:'ams',net:'lvl',tier:1});ACT.buyIx({city:'ams~3',tier:1});ACT.buyIx({city:'ams',tier:1});compute()");
  ev("S.pni.push({id:uid(),city:'fra',net:'ggl',tier:1});R.demTo.nfx=1e4;ACT.cache({city:'fra',net:'nfx'});R.demTo.nfx=1e4;ACT.cache({city:'fra',net:'nfx'});compute()");
  const all = JSON.parse(ev('JSON.stringify(conns())'));
  const by = (k) => all.filter((r) => r.k === k);
  assert.equal(by('t').length, 2);
  assert.equal(by('ix').length, 2);
  assert.equal(by('p').length, 1);
  assert.equal(by('c').length, 1, 'cache boxes of one CDN in one city are one row');
  assert.match(by('c')[0].port, /2 boxes/);
  // the listed prices add up to what the month actually costs
  const sum = (k) => by(k).reduce((a, r) => a + r.mo, 0);
  assert.ok(Math.abs(sum('t') - ev('R.cost.transit')) < 0.01, 'transit');
  assert.ok(Math.abs(sum('ix') - ev('R.cost.ix')) < 0.01, 'IX');
  assert.ok(Math.abs(sum('p') - ev('R.cost.pni')) < 0.01, 'PNI');
  assert.equal(sum('c'), ev('R.cost.caches'));
  // the dashboard section, with filters
  ev("ACT.connOpen()");
  const rows = () => doc.querySelectorAll('#connSec tbody tr').length;
  assert.equal(rows(), all.length);
  ev("ACT.connF({f:'k',v:'t'})");
  assert.equal(rows(), 2, 'transit only (#38)');
  const sel = doc.querySelector('#connSec select[data-chg="connCity"]');
  sel.value = 'ams'; sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(rows(), 1, 'transit in Amsterdam');
  assert.match(doc.querySelector('#connSec tbody').textContent, /Amsterdam/);
  ev("ACT.connF({f:'all'})");
  ev("ACT.connNet({v:'ggl'})");
  assert.ok(rows() >= 1, 'a network filter finds its PNI and the exchanges it peers at');
  assert.ok([...doc.querySelectorAll('#connSec tbody tr')].every((tr) => /Google|IX/.test(tr.textContent)));
  ev("ACT.connCity({v:'nope'});ACT.connNet({v:'nope'});ACT.connF({f:'k',v:'nope'})");
  assert.deepEqual(JSON.parse(ev('JSON.stringify(UI.cf)')), { k: '', city: '', net: '' }, 'bad filter values are ignored');
  // Open closes the dashboard and goes to the right tab of that POP
  ev("ACT.goConn({city:'ams',k:'t'})");
  assert.equal(ev("$('dash').hidden"), true);
  assert.equal(ev('UI.sel.id'), 'ams');
  assert.equal(ev('UI.tab'), 'up');
  ev("ACT.goConn({city:'fra',k:'c'})");
  assert.equal(ev('UI.tab'), 'peer');
  // the Networks tab says where each network is connected (#33)
  ev("UI.left='nets';UI.leftOpen=true;renderLeft()");
  const cog = [...doc.querySelectorAll('#leftBody .row')].find((r) => /Cogent/.test(r.textContent));
  const jump = cog.querySelector('[data-act="goConn"]');
  assert.ok(jump, 'Cogent shows a jump button');
  assert.match(jump.textContent, /Transit.*Frankfurt/);
  assert.deepEqual(errors, []);
});

test('#13 #15 unhappy customers warn early, furious ones pause the game (optional)', () => {
  const { ev, errors } = load();
  base(ev);
  ev("S.biz.push({id:'b1',city:'fra',city2:null,reqs:[],name:'Llama Logistics',type:'dia',bw:5,rate:100,mood:100,since:-100});compute();ACT.speed({v:4})");
  const toasts = () => ev("document.getElementById('toasts').textContent");
  // service collapses: happiness falls through 60% (warning) then 30% (furious, paused)
  ev("bizSf=()=>0.6");
  for (let i = 0; i < 3; i++) ev('dayTick()');
  assert.match(toasts(), /Llama Logistics is getting unhappy/);
  assert.match(toasts(), /getting only 60%/, 'the warning says why');
  assert.equal(ev('UI.speed'), 4, 'a warning does not pause');
  for (let i = 0; i < 4 && ev('UI.speed') !== 0; i++) ev('dayTick()');
  assert.match(toasts(), /Llama Logistics is furious/);
  assert.equal(ev('UI.speed'), 0, 'furious pauses the game');
  assert.match(toasts(), /Game paused/);
  assert.equal(ev('UI.resumeSpeed'), 4, 'Resume goes back to the old speed');
  // the setting turns it off
  ev("setPref('pauseFurious',false);setPref('warnUnhappy',false);S.biz.push({id:'b2',city:'fra',city2:null,reqs:[],name:'Snack Overflow',type:'dia',bw:5,rate:100,mood:100,since:-100});ACT.speed({v:2})");
  for (let i = 0; i < 5; i++) ev('dayTick()');
  assert.ok(ev("S.biz.find(b=>b.id==='b2').mood") < 30);
  assert.equal(ev('UI.speed'), 2, 'no pause with the setting off');
  assert.doesNotMatch(toasts(), /Snack Overflow is getting unhappy/);
  assert.equal(ev("JSON.parse(localStorage.getItem('sot-prefs')).pauseFurious"), false, 'stored per device');
  assert.deepEqual(errors, []);
});

test('#14 customers overview lists everyone with happiness, reasons and a jump', () => {
  const { ev, dom, errors } = load();
  base(ev);
  const doc = dom.window.document;
  ev("ACT.buildPop({city:'ams'});S.biz.push({id:'c1',city:'fra',city2:null,reqs:[],name:'Happy Hamster',type:'dia',bw:10,rate:100,mood:95,since:-100},{id:'c2',city:'ams',city2:null,reqs:[],name:'Grumpy Goat',type:'host',bw:20,rate:100,mood:40,since:-100});compute();renderAll()");
  const st = JSON.parse(ev('JSON.stringify(custStats())'));
  assert.equal(st.n, 2);
  assert.equal(st.unhappy, 1);
  assert.equal(st.risk, 2000, 'the unhappy customer pays 2000/mo');
  assert.ok(st.avg > 40 && st.avg < 95, 'happiness is weighted by what they pay');
  assert.equal(ev("$('hCust').hidden"), false, 'HUD shows customer happiness');
  assert.match(ev("$('hCustVal').textContent"), /%/);
  ev('ACT.custOpen({})');
  const names = () => [...doc.querySelectorAll('#custSec .row .nm')].map((n) => n.textContent);
  assert.equal(names().length, 2);
  assert.match(names()[0], /Grumpy Goat/, 'unhappiest first');
  ev("ACT.custF({v:'sad'})");
  assert.equal(names().length, 1);
  ev("ACT.custF({v:''});ACT.custCity({v:'fra'})");
  assert.deepEqual(names().map((n) => n.split(' ')[0]), ['Happy']);
  ev("ACT.custGo({id:'c2'})");
  assert.equal(ev("$('dash').hidden"), true);
  assert.equal(ev('UI.sel.id'), 'ams');
  assert.equal(ev('UI.tab'), 'cust');
  // the Deals tab summary
  ev("UI.left='deals';UI.leftOpen=true;UI.sel=null;renderLeft()");
  assert.match(doc.getElementById('leftBody').textContent, /1 unhappy customer/);
  assert.deepEqual(errors, []);
});

test('settings screen holds every option and opens from the menu and the title screen', () => {
  const { ev, errors } = load();
  ev('showTitle();ACT.settings()');
  const card = () => ev("document.getElementById('modalCard').textContent");
  for (const t of [/Pause when a customer is furious/, /Warn when a customer gets unhappy/, /Pause on outages/, /Animations/, /Sound/, /Language/]) assert.match(card(), t);
  ev("ACT.prefSet({v:'pauseIncident:1'})");
  assert.equal(ev("pref('pauseIncident')"), true);
  ev("ACT.prefSet({v:'nope:1'})");
  assert.equal(ev("'nope' in PREFS"), false, 'unknown settings are ignored');
  ev('ACT.settingsClose()');
  assert.match(card(), /Start building|Name your network/, 'back to the title screen');
  ev('ACT.start({});ACT.menu();ACT.settings();ACT.settingsClose()');
  assert.equal(ev("document.getElementById('modal').hidden"), true);
  assert.deepEqual(errors, []);
});

test('#42 the share card draws links across the date line on both edges of the map', () => {
  const { ev, errors } = load();
  base(ev);
  ev("S.links.push({id:'x1',a:'tok',b:'sea',kind:'wave',tier:0,km:7700,mult:1,mo:0},{id:'x2',a:'sea',b:'tok',kind:'wave',tier:0,km:7700,mult:1,mo:0},{id:'x3',a:'fra',b:'ams',kind:'wave',tier:0,km:400,mult:1,mo:0})");
  const segs = JSON.parse(ev('JSON.stringify(linkSegs())'));
  assert.equal(segs.length, 5, 'two segments for each date-line link, one for the short one');
  for (const id of ['x1', 'x2']) {
    const mine = JSON.parse(ev(`JSON.stringify((()=>{S.links=S.links.filter(l=>l.id==='${id}');return linkSegs();})())`));
    ev("S.links=[]");
    assert.ok(mine.some(([a, , b]) => Math.min(a, b) < 0), `${id} reaches past the left edge`);
    assert.ok(mine.some(([a, , b]) => Math.max(a, b) > ev('W')), `${id} reaches past the right edge`);
    ev("S.links.push({id:'x1',a:'tok',b:'sea',kind:'wave',tier:0,km:7700,mult:1,mo:0},{id:'x2',a:'sea',b:'tok',kind:'wave',tier:0,km:7700,mult:1,mo:0})");
  }
  ev('shareCanvas()');
  assert.deepEqual(errors, []);
});

test('#45 unplugged optics go on a spares shelf, get reused for free, or sold for 40%', () => {
  const { ev, errors } = load();
  base(ev);
  ev("S.lvl=4;ACT.buildPop({city:'ams'});S.pops.fra.rgen=S.pops.ams.rgen=RG.length-1;S.links.push({id:'df1',a:'fra',b:'ams',kind:'df',km:450,sys:'roadm',ch:[],ready:0,mo:500,day:0,cut:0});compute()");
  const o = ev("Object.keys(OPT).find(k=>!chWhy(S.links[0],k))");
  const c0 = ev('S.cash');
  ev(`ACT.addCh({id:'df1',o:'${o}'})`);
  const price = c0 - ev('S.cash');
  assert.ok(price > 0);
  ev(`ACT.rmCh({id:'df1',o:'${o}'})`);
  assert.equal(ev(`S.spares['${o}']`), 1, 'the optic goes on the shelf');
  const c1 = ev('S.cash');
  ev(`ACT.addCh({id:'df1',o:'${o}'})`);
  assert.equal(ev('S.cash'), c1, 'plugging it back in is free');
  assert.equal(ev(`S.spares['${o}']`), 0);
  ev(`ACT.rmCh({id:'df1',o:'${o}'});ACT.sellSpare({o:'${o}'})`);
  assert.equal(ev('S.cash') - c1, Math.round(price * 0.4), 'sold for 40% of its price');
  ev(`ACT.sellSpare({o:'${o}'})`);
  assert.equal(ev('S.cash') - c1, Math.round(price * 0.4), 'nothing to sell twice');
  // the shelf survives a save and junk is cleaned
  ev(`S.spares={'${o}':2,nope:5,x:-1};S=migrate(JSON.parse(JSON.stringify(S)))`);
  assert.deepEqual(JSON.parse(ev('JSON.stringify(S.spares)')), { [o]: 2 });
  assert.deepEqual(errors, []);
});

test('#35 your own trench can light another fiber pair once a ROADMaster is full', () => {
  const { ev, errors } = load();
  base(ev);
  ev("S.lvl=4;ACT.buildPop({city:'ams'});S.pops.fra.rgen=S.pops.ams.rgen=RG.length-1;S.pops.fra.routers=S.pops.ams.routers=RMAX;S.links.push({id:'own1',a:'fra',b:'ams',kind:'df',own:true,km:450,sys:'roadm',ch:[],ready:0,mo:500,day:0,cut:0});compute()");
  assert.equal(ev("chMax(S.links[0])"), 64);
  ev("ACT.addPair({id:'own1'})");
  assert.equal(ev("S.links[0].pairs||1"), 1, 'not before the first pair is full');
  ev("S.links[0].ch=Array(64).fill('zr4');compute()");
  assert.match(ev("chWhy(S.links[0],'zr4')"), /full/);
  const c0 = ev('S.cash'), mo0 = ev('R.cost.optical');
  ev("ACT.addPair({id:'own1'})");
  assert.equal(ev('S.links[0].pairs'), 2);
  assert.equal(ev('chMax(S.links[0])'), 128);
  assert.equal(c0 - ev('S.cash'), ev('pairCost(S.links[0])'), 'a ROADMaster plus a chain of amplifiers');
  assert.ok(ev('R.cost.optical') > mo0, 'the new amplifier huts cost monthly');
  assert.ok(!/full/.test(ev("chWhy(S.links[0],'zr4')")), 'room for more channels');
  // leased fiber and the smaller line system stay at one pair
  ev("S.links.push({id:'iru',a:'fra',b:'ams',kind:'df',own:false,km:450,sys:'roadm',ch:Array(64).fill('zr4'),ready:0,mo:500,day:0,cut:0});ACT.addPair({id:'iru'})");
  assert.equal(ev("S.links[1].pairs||1"), 1);
  ev("S.links[0].pairs=99;S=migrate(JSON.parse(JSON.stringify(S)))");
  assert.equal(ev('S.links[0].pairs'), 4, 'saves are clamped to four pairs');
  assert.deepEqual(errors, []);
});

test('#64 your own subsea cable runs beside the route, however many waves share it', () => {
  const { ev, errors } = load();
  base(ev);
  ev("ACT.buildPop({city:'lon'});ACT.buildPop({city:'dub'});S.links.push({id:'own',a:'lon',b:'dub',kind:'df',own:true,sub:true,km:475,sys:'roadm',ch:[],ready:0,mo:1,day:0,cut:0});GEO.clear()");
  const span = "(()=>{const g=linkGeom(S.links.find(l=>l.id==='own')),A=CITY.lon,B=CITY.dub;return Math.max(...g.pts.map(p=>segDist(p[0],p[1],[A.x,A.y],[B.x,B.y])));})()";
  const alone = ev(span);
  ev("for(let i=0;i<8;i++)S.links.unshift({id:'w'+i,a:'lon',b:'dub',kind:'wave',tier:2,km:475,sub:true,cable:'celtix',mo:1,mult:1,trench:'cab:celtix',cut:0,day:0});GEO.clear()");
  const crowded = ev(span);
  assert.ok(Math.abs(crowded - alone) < 0.01, 'the shape does not grow with the waves');
  assert.ok(crowded < 8, `stays close to the route (${crowded.toFixed(1)})`);
  const g = ev("linkGeom(S.links.find(l=>l.id==='own')).pts");
  assert.ok(Math.hypot(g[0][0] - ev('CITY.lon.x'), g[0][1] - ev('CITY.lon.y')) < 1, 'still starts in London');
  assert.deepEqual(errors, []);
});
