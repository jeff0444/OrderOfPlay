(function(){
  "use strict";

  // Skill/level ranges per sport. Edit here to add a sport or change a range.
  const SPORT_CONFIGS = {
    badminton:  { label: "羽球",   min: 3,   max: 12,  step: 1 },
    pickleball: { label: "匹克球", min: 1.0, max: 5.0, step: 0.5 },
    tennis:     { label: "網球",   min: 1.0, max: 7.0, step: 0.5 }
  };
  const DEFAULT_SPORT = "badminton";

  const STORAGE_KEY = "badminton_scheduler_state_v3";

  function uid(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

  function makeCourt(number){
    return { id: uid(), number: String(number), currentMatch: null, retiring: false, roundNumber: 0 };
  }

  function defaultState(){
    return {
      players: [],       // {id,name,skill,fixedPartnerId,checkedIn,resting,left,removed,gamesPlayed,wins,losses,lastPlayedTick}
      sport: DEFAULT_SPORT,
      mode: "doubles",   // doubles | singles — last-used default for building a match
      courts: [makeCourt(1), makeCourt(2)],
      nextCourtNumber: 3,
      pending: [],        // queued-but-unassigned matches: {id, matchMode, teamA, teamB}
      globalTick: 0,
      pairHistory: {},   // "id1|id2" (sorted) -> times partnered
      oppHistory: {},    // "id1|id2" (sorted) -> times opposed
      history: []        // finished matches: {matchId, ts, courtLabel, roundNumber, teamA, teamB, scoreA, scoreB, winner}
    };
  }

  let state = load();
  let genUI = null;    // { matchMode:'doubles'|'singles', teamOf:Map(id->'left'|'right') } while building a pending match

  function load(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const merged = Object.assign(defaultState(), parsed);
      if(!SPORT_CONFIGS[merged.sport]) merged.sport = DEFAULT_SPORT;
      return merged;
    }catch(e){
      console.error("load failed", e);
      return defaultState();
    }
  }
  function save(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function sportConfig(){ return SPORT_CONFIGS[state.sport]; }

  function clampSkill(v){
    const cfg = sportConfig();
    if(v > cfg.max) v = cfg.max;
    if(v < cfg.min) v = cfg.min;
    return Math.round(v * 100) / 100;
  }
  function defaultSkill(){
    const cfg = sportConfig();
    return clampSkill(Math.round(((cfg.min + cfg.max) / 2) / cfg.step) * cfg.step);
  }
  function formatSkillNumber(v){
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }
  function skillDisplay(skill){ return "Lv"+formatSkillNumber(skill); }
  function skillCell(skill){ return formatSkillNumber(skill); }

  function eligiblePlayers(){
    return state.players.filter(p => !p.removed && p.checkedIn && !p.resting && !p.left);
  }
  function playerById(id){ return state.players.find(p => p.id === id); }
  function pairKey(a,b){ return [a,b].sort().join("|"); }

  // ---------- shared line icons (stroke=currentColor so buttons pick up their own color) ----------
  const ICON_PATHS = {
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>'
  };
  function iconSvg(name, size){
    size = size || 16;
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`;
  }

  // ---------- Tabs ----------
  document.querySelectorAll("nav.tabs button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll("nav.tabs button").forEach(b=>b.classList.remove("active"));
      document.querySelectorAll("section.tab").forEach(s=>s.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-"+btn.dataset.tab).classList.add("active");
      if(btn.dataset.tab === "stats") renderStats();
      if(btn.dataset.tab === "schedule") renderSchedule();
      if(btn.dataset.tab === "roster") renderPlayers();
    });
  });

  // ---------- Players tab ----------
  function refreshPartnerSelect(){
    const sel = document.getElementById("np-partner");
    const prev = sel.value;
    sel.innerHTML = '<option value="">無搭檔</option>';
    state.players.forEach(p=>{
      if(p.removed) return;
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
    if([...sel.options].some(o=>o.value === prev)) sel.value = prev;
  }

  function applySkillInputBounds(resetValue){
    const cfg = sportConfig();
    const el = document.getElementById("np-skill");
    if(!el) return;
    el.min = cfg.min; el.max = cfg.max; el.step = cfg.step;
    if(resetValue) el.value = ""; // leave blank so the "程度" placeholder shows; defaultSkill() is still used as a fallback on submit
  }

  function makePlayer(name, skill, checkedIn){
    return { id: uid(), name, skill: clampSkill(skill), fixedPartnerId: null,
      checkedIn: !!checkedIn, resting: false, left: false, removed: false,
      gamesPlayed: 0, wins: 0, losses: 0, lastPlayedTick: 0 };
  }

  function nameExists(name){
    return state.players.some(p=>!p.removed && p.name === name);
  }

  document.getElementById("btn-add-player").addEventListener("click", ()=>{
    const nameEl = document.getElementById("np-name");
    const name = nameEl.value.trim();
    if(!name){ alert("姓名不能是空白"); nameEl.focus(); return; }
    if(nameExists(name)){ alert("姓名「"+name+"」已經存在，請用不同名稱。"); nameEl.focus(); return; }
    const skillRaw = parseFloat(document.getElementById("np-skill").value);
    const skill = isNaN(skillRaw) ? defaultSkill() : skillRaw;
    const partnerId = document.getElementById("np-partner").value || null;
    const p = makePlayer(name, skill, true);
    p.fixedPartnerId = partnerId;
    state.players.push(p);
    if(partnerId){
      const partner = playerById(partnerId);
      if(partner) partner.fixedPartnerId = p.id; // mutual link
    }
    nameEl.value = "";
    document.getElementById("np-partner").value = "";
    applySkillInputBounds(true);
    save();
    renderPlayers();
  });

  // ---------- Roster CSV (space-delimited): 姓名 程度 搭檔 ----------
  function parseRosterLine(line){
    const parts = line.trim().split(/\s+/);
    if(!parts.length || !parts[0]) return null;
    const name = parts[0];
    let skill = defaultSkill();
    if(parts[1] !== undefined){
      const v = parseFloat(parts[1]);
      if(!isNaN(v)) skill = clampSkill(v);
    }
    const partnerName = parts.slice(2).join(" ");
    return { name, skill, partnerName: (partnerName && partnerName !== "-") ? partnerName : "" };
  }

  function linkPartnersByName(added){
    added.forEach(({player, partnerName})=>{
      if(!partnerName || player.fixedPartnerId) return;
      const partner = state.players.find(q=>q.name === partnerName && q.id !== player.id && !q.removed);
      if(partner && !partner.fixedPartnerId){
        player.fixedPartnerId = partner.id;
        partner.fixedPartnerId = player.id;
      }
    });
  }

  // parses multi-line roster text and appends players (used by both the
  // page's batch-add box and the "開新場" modal's batch box / CSV import).
  // Names must be unique: duplicates against the existing roster, or repeated
  // within the same batch, are skipped (first occurrence wins) and reported.
  function addRosterFromText(text, checkedIn){
    const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(l=>l && !l.startsWith("#"));
    const added = [];
    const skipped = [];
    const seenNames = new Set(state.players.filter(p=>!p.removed).map(p=>p.name));
    lines.forEach(line=>{
      const parsed = parseRosterLine(line);
      if(!parsed || !parsed.name) return;
      if(seenNames.has(parsed.name)){
        skipped.push(parsed.name);
        return;
      }
      seenNames.add(parsed.name);
      const p = makePlayer(parsed.name, parsed.skill, checkedIn);
      state.players.push(p);
      added.push({ player:p, partnerName: parsed.partnerName });
    });
    linkPartnersByName(added);
    return { added, skipped };
  }

  document.getElementById("btn-bulk-add").addEventListener("click", ()=>{
    const raw = document.getElementById("bulk-text").value;
    if(!raw.trim()) return;
    const { added, skipped } = addRosterFromText(raw, true);
    document.getElementById("bulk-text").value = "";
    save();
    renderPlayers();
    let msg = "已新增 "+added.length+" 位球員";
    if(skipped.length) msg += "\n以下姓名重複，已略過：" + skipped.join("、");
    alert(msg);
  });

  document.getElementById("btn-export").addEventListener("click", ()=>{
    const lines = ["# 姓名 程度 搭檔"];
    state.players.filter(p=>!p.removed).forEach(p=>{
      const partner = p.fixedPartnerId ? playerById(p.fixedPartnerId) : null;
      lines.push([p.name, formatSkillNumber(p.skill), partner ? partner.name : "-"].join(" "));
    });
    const blob = new Blob([lines.join("\n")], {type:"text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0,10);
    a.href = url; a.download = "players-"+stamp+".csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  });

  document.getElementById("file-import").addEventListener("change", (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      try{
        const lines = reader.result.split(/\r?\n/).map(l=>l.trim()).filter(l=>l && !l.startsWith("#"));
        if(!lines.length) throw new Error("找不到任何球員資料");
        if(!confirm("匯入將會取代目前的球員名單，並清除上場次數／比分／歷史紀錄，確定要繼續嗎？")) return;
        state.players = [];
        const { added, skipped } = addRosterFromText(reader.result, true);
        resetParticipationOnly();
        save();
        renderPlayers(); renderSchedule(); renderStats();
        let msg = "匯入成功，共 "+added.length+" 位球員";
        if(skipped.length) msg += "\n以下姓名重複，已略過：" + skipped.join("、");
        alert(msg);
      }catch(err){
        alert("匯入失敗：" + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  document.getElementById("btn-mark-all-active").addEventListener("click", ()=>{
    state.players.forEach(p=>{ if(!p.removed) p.checkedIn = true; });
    save();
    renderPlayers();
  });

  function renderStatusButtons(p){
    const wrap = document.createElement("div");
    wrap.className = "status-btns";

    const checkinBtn = document.createElement("button");
    checkinBtn.className = "status-btn checkin " + (p.checkedIn ? "on" : "off");
    checkinBtn.textContent = p.checkedIn ? "已報到" : "未報到";
    checkinBtn.addEventListener("click", ()=>{ p.checkedIn = !p.checkedIn; save(); renderPlayers(); });

    const restBtn = document.createElement("button");
    restBtn.className = "status-btn rest " + (p.resting ? "on" : "off");
    restBtn.textContent = "休息";
    restBtn.addEventListener("click", ()=>{ p.resting = !p.resting; save(); renderPlayers(); });

    const leaveBtn = document.createElement("button");
    leaveBtn.className = "status-btn leave " + (p.left ? "on" : "off");
    leaveBtn.textContent = "離場";
    leaveBtn.addEventListener("click", ()=>{ p.left = !p.left; save(); renderPlayers(); });

    wrap.appendChild(checkinBtn);
    wrap.appendChild(restBtn);
    wrap.appendChild(leaveBtn);
    return wrap;
  }

  let editingPlayerId = null;

  function unlinkPartner(p){
    if(!p.fixedPartnerId) return;
    const old = playerById(p.fixedPartnerId);
    if(old) old.fixedPartnerId = null;
    p.fixedPartnerId = null;
  }
  function linkPartner(p, partnerId){
    unlinkPartner(p);
    if(!partnerId) return;
    const partner = playerById(partnerId);
    if(!partner) return;
    unlinkPartner(partner);
    p.fixedPartnerId = partner.id;
    partner.fixedPartnerId = p.id;
  }

  function renderEditableRow(p){
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = p.name;

    const skillTd = document.createElement("td");
    const skillInput = document.createElement("input");
    skillInput.type = "number";
    skillInput.className = "skill-input";
    const cfg = sportConfig();
    skillInput.min = cfg.min; skillInput.max = cfg.max; skillInput.step = cfg.step;
    skillInput.value = p.skill;
    skillTd.appendChild(skillInput);

    const partnerTd = document.createElement("td");
    const partnerSelect = document.createElement("select");
    const noneOpt = document.createElement("option");
    noneOpt.value = ""; noneOpt.textContent = "無搭檔";
    partnerSelect.appendChild(noneOpt);
    state.players.forEach(q=>{
      if(q.removed || q.id === p.id) return;
      const opt = document.createElement("option");
      opt.value = q.id; opt.textContent = q.name;
      if(p.fixedPartnerId === q.id) opt.selected = true;
      partnerSelect.appendChild(opt);
    });
    partnerTd.appendChild(partnerSelect);

    const statusTd = document.createElement("td");
    statusTd.appendChild(renderStatusButtons(p));

    const actionsTd = document.createElement("td");
    actionsTd.className = "actions-cell";
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn small";
    saveBtn.textContent = "儲存";
    saveBtn.addEventListener("click", ()=>{
      const skillRaw = parseFloat(skillInput.value);
      p.skill = isNaN(skillRaw) ? p.skill : clampSkill(skillRaw);
      linkPartner(p, partnerSelect.value || null);
      editingPlayerId = null;
      save(); renderPlayers();
    });
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn secondary small";
    cancelBtn.textContent = "取消";
    cancelBtn.addEventListener("click", ()=>{ editingPlayerId = null; renderPlayers(); });
    actionsTd.appendChild(saveBtn);
    actionsTd.appendChild(cancelBtn);

    tr.appendChild(nameTd);
    tr.appendChild(skillTd);
    tr.appendChild(partnerTd);
    tr.appendChild(statusTd);
    tr.appendChild(actionsTd);
    return tr;
  }

  function renderPlayerRow(p){
    const tr = document.createElement("tr");
    const partner = p.fixedPartnerId ? playerById(p.fixedPartnerId) : null;
    tr.innerHTML = `
      <td>${escapeHtml(p.name)}</td>
      <td><span class="skill">${skillCell(p.skill)}</span></td>
      <td>${partner ? escapeHtml(partner.name) : '<span class="muted">—</span>'}</td>
      <td></td>
      <td></td>
    `;
    tr.children[3].appendChild(renderStatusButtons(p));
    const actionsTd = tr.querySelector("td:last-child");
    actionsTd.className = "actions-cell";
    const modifyBtn = document.createElement("button");
    modifyBtn.className = "btn secondary small icon-btn";
    modifyBtn.innerHTML = iconSvg("pencil");
    modifyBtn.title = "修改"; modifyBtn.setAttribute("aria-label", "修改");
    modifyBtn.addEventListener("click", ()=>{ editingPlayerId = p.id; renderPlayers(); });
    const delBtn = document.createElement("button");
    delBtn.className = "btn danger small icon-btn";
    delBtn.innerHTML = iconSvg("trash");
    delBtn.title = "刪除"; delBtn.setAttribute("aria-label", "刪除");
    delBtn.addEventListener("click", ()=>{
      if(!confirm("確定要刪除「"+p.name+"」嗎？")) return;
      unlinkPartner(p);
      p.removed = true;
      if(editingPlayerId === p.id) editingPlayerId = null;
      save(); renderPlayers();
    });
    actionsTd.appendChild(modifyBtn);
    actionsTd.appendChild(delBtn);
    return tr;
  }

  function renderPlayers(){
    refreshPartnerSelect();
    applySkillInputBounds(false);
    const cfg = sportConfig();
    document.getElementById("sport-note").textContent =
      "目前球種："+cfg.label+"（程度 "+formatSkillNumber(cfg.min)+"～"+formatSkillNumber(cfg.max)+"）";
    const tbody = document.getElementById("player-table-body");
    tbody.innerHTML = "";
    const visible = state.players.filter(p=>!p.removed);
    document.getElementById("player-empty").style.display = visible.length ? "none":"block";
    document.getElementById("player-count").textContent = visible.length ? "（共 "+visible.length+" 人）" : "";
    if(editingPlayerId && !visible.some(p=>p.id === editingPlayerId)) editingPlayerId = null;
    visible.forEach(p=>{
      tbody.appendChild(editingPlayerId === p.id ? renderEditableRow(p) : renderPlayerRow(p));
    });
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  // ---------- 開新場 modal ----------
  const modalOverlay = document.getElementById("modal-overlay");

  function openModal(){
    document.getElementById("modal-sport").value = state.sport;
    document.getElementById("modal-courts").value = state.courts.length || 2;
    document.getElementById("modal-mode").value = state.mode;
    document.getElementById("modal-bulk-text").value = "";
    document.getElementById("modal-file-import").value = "";
    document.getElementById("modal-file-name").textContent = "";
    modalOverlay.hidden = false;
  }
  function closeModal(){ modalOverlay.hidden = true; }

  document.getElementById("btn-open-modal").addEventListener("click", openModal);
  document.getElementById("modal-cancel-btn").addEventListener("click", closeModal);
  document.getElementById("modal-close-btn").addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e)=>{ if(e.target === modalOverlay) closeModal(); });
  document.addEventListener("keydown", (e)=>{
    if(e.key === "Escape" && !modalOverlay.hidden) closeModal();
  });
  document.getElementById("modal-file-import").addEventListener("change", (e)=>{
    const f = e.target.files[0];
    document.getElementById("modal-file-name").textContent = f ? f.name : "";
  });

  function startNewSession(sport, courtCount, mode){
    state.sport = sport;
    state.players = [];
    state.mode = mode;
    state.courts = [];
    state.nextCourtNumber = 1;
    for(let i=0;i<courtCount;i++){ state.courts.push(makeCourt(state.nextCourtNumber)); state.nextCourtNumber++; }
    state.pending = [];
    state.globalTick = 0;
    state.pairHistory = {};
    state.oppHistory = {};
    state.history = [];
  }

  function resetParticipationOnly(){
    state.players.forEach(p=>{ p.gamesPlayed=0; p.wins=0; p.losses=0; p.lastPlayedTick=0; });
    state.courts.forEach(c=>{ c.currentMatch=null; c.retiring=false; c.roundNumber=0; });
    state.pending = [];
    state.globalTick = 0;
    state.pairHistory = {};
    state.oppHistory = {};
    state.history = [];
  }

  // Clears everything — including the player roster — then (re)builds the roster from
  // whatever the modal's file import / batch-paste box supplied, in that order.
  function finishOpeningSession(sport, fileText){
    const bulkText = document.getElementById("modal-bulk-text").value;
    const newCourtCount = Math.max(1, parseInt(document.getElementById("modal-courts").value,10) || 1);
    const newMode = document.getElementById("modal-mode").value;
    startNewSession(sport, newCourtCount, newMode); // wipes players + all session state first
    let skipped = [];
    if(fileText) skipped = skipped.concat(addRosterFromText(fileText, false).skipped);
    if(bulkText.trim()) skipped = skipped.concat(addRosterFromText(bulkText, false).skipped);
    save();
    renderPlayers(); renderStats();
    closeModal();
    document.querySelector('nav.tabs button[data-tab="roster"]').click();
    if(skipped.length) alert("以下姓名重複，已略過：" + skipped.join("、"));
  }

  document.getElementById("modal-start-btn").addEventListener("click", ()=>{
    const anyProgress = state.players.length > 0 || state.courts.some(c=>c.currentMatch) ||
      state.pending.length > 0 || state.history.length > 0;
    if(anyProgress){
      if(!confirm("開新場會清除目前的球員名單、上場次數、比分與歷史紀錄，確定要開始新的一場嗎？")) return;
    }
    const sport = document.getElementById("modal-sport").value;
    const file = document.getElementById("modal-file-import").files[0];
    if(file){
      const reader = new FileReader();
      reader.onload = ()=>{ finishOpeningSession(sport, reader.result); };
      reader.readAsText(file);
    } else {
      finishOpeningSession(sport, null);
    }
  });

  // ---------- Scheduling engine ----------
  function buildUnits(pool, matchMode){
    // group pool players into fixed-pair units (size 2, both must be in `pool`) or solo units (size 1)
    const seen = new Set();
    const units = [];
    pool.forEach(p=>{
      if(seen.has(p.id)) return;
      const partner = (matchMode === "doubles" && p.fixedPartnerId) ? playerById(p.fixedPartnerId) : null;
      if(partner && pool.includes(partner) && !seen.has(partner.id)){
        units.push({ size:2, members:[p, partner] });
        seen.add(p.id); seen.add(partner.id);
      } else {
        units.push({ size:1, members:[p] });
        seen.add(p.id);
      }
    });
    return units;
  }

  function fairnessScore(unit){
    // fewer games played always goes first; players with the same games-played
    // count are true ties here (not broken by wait time), so the fill-selection
    // search below is free to pick among them for skill balance / fewer repeats,
    // with wait time folded in as a soft (not absolute) preference.
    return Math.min(...unit.members.map(m=>m.gamesPlayed));
  }
  function unitWaitScore(unit){
    return state.globalTick - Math.max(...unit.members.map(m=>m.lastPlayedTick));
  }

  function repeatPenalty(matches){
    let penalty = 0;
    matches.forEach(m=>{
      const teamA = m.teamA, teamB = m.teamB;
      [teamA, teamB].forEach(team=>{
        if(team.length === 2){
          const [x,y] = team;
          const px = playerById(x);
          if(px.fixedPartnerId !== y){
            penalty += (state.pairHistory[pairKey(x,y)] || 0);
          }
        }
      });
      teamA.forEach(x=>{
        teamB.forEach(y=>{
          penalty += (state.oppHistory[pairKey(x,y)] || 0);
        });
      });
    });
    return penalty;
  }

  function teamPenalty(teamA, teamB){
    let penalty = repeatPenalty([{teamA, teamB}]);
    const skillA = teamA.reduce((s,id)=>s+playerById(id).skill, 0);
    const skillB = teamB.reduce((s,id)=>s+playerById(id).skill, 0);
    penalty += Math.abs(skillA - skillB) * 0.5; // soft preference for skill-balanced teams
    return penalty;
  }

  // fills two "bins" (left/right) of given capacity from `units` (size 1 or 2),
  // preferring to place a size-2 unit whenever a bin still has room for both members.
  // returns null if the units can't be split to hit both capacities exactly.
  function packTwoSides(units, capLeft, capRight, leftFirst){
    const pairs = units.filter(u=>u.size===2).slice();
    const solos = units.filter(u=>u.size===1).slice();
    function fillBin(cap){
      const bin = [];
      while(cap > 0){
        if(cap >= 2 && pairs.length){ bin.push(pairs.shift()); cap -= 2; }
        else if(solos.length){ bin.push(solos.shift()); cap -= 1; }
        else return null;
      }
      return bin;
    }
    let left, right;
    if(leftFirst){
      left = fillBin(capLeft); if(left === null) return null;
      right = fillBin(capRight); if(right === null) return null;
    } else {
      right = fillBin(capRight); if(right === null) return null;
      left = fillBin(capLeft); if(left === null) return null;
    }
    if(pairs.length || solos.length) return null;
    return { left, right };
  }

  // players currently on a court OR already queued in another pending match — never
  // double-booked into two matches at once
  function committedPlayerIds(excludePendingIds){
    const excludeSet = new Set(excludePendingIds || []);
    const set = new Set();
    state.courts.forEach(c=>{
      if(c.currentMatch){
        c.currentMatch.teamA.forEach(id=>set.add(id));
        c.currentMatch.teamB.forEach(id=>set.add(id));
      }
    });
    state.pending.forEach(m=>{
      if(excludeSet.has(m.id)) return;
      m.teamA.forEach(id=>set.add(id));
      m.teamB.forEach(id=>set.add(id));
    });
    return set;
  }
  function eligiblePoolForPending(excludePendingIds){
    const committed = committedPlayerIds(excludePendingIds);
    return eligiblePlayers().filter(p=>!committed.has(p.id));
  }

  // Builds one match from a per-player left/right/(random) assignment: players
  // pinned to "left"/"right" (and their fixed partner, auto-pulled to the same side) are
  // guaranteed a spot on that side; every remaining ("random") slot on either side is
  // filled automatically from the rest of the eligible pool, balancing skill and avoiding
  // recent repeat opponents/partners. Leaving everyone on "random" reproduces the old
  // fully-automatic behavior; pinning everyone reproduces fully-manual.
  function buildMatchFromSides(matchMode, teamOf, excludePendingIds){
    const need = matchMode === "doubles" ? 4 : 2;
    const halfNeed = need / 2;
    const pool = eligiblePoolForPending(excludePendingIds);
    const poolIds = new Set(pool.map(p=>p.id));

    const forcedLeft = new Set(), forcedRight = new Set();
    pool.forEach(p=>{
      const side = teamOf.get(p.id);
      if(side === "left") forcedLeft.add(p.id);
      else if(side === "right") forcedRight.add(p.id);
    });

    if(matchMode === "doubles"){
      for(const p of pool){
        if(!p.fixedPartnerId) continue;
        const partner = playerById(p.fixedPartnerId);
        if(!partner || !poolIds.has(partner.id)) continue;
        const sideP = forcedLeft.has(p.id) ? "left" : forcedRight.has(p.id) ? "right" : null;
        const sideQ = forcedLeft.has(partner.id) ? "left" : forcedRight.has(partner.id) ? "right" : null;
        if(sideP && sideQ && sideP !== sideQ){
          return { error: "固定搭檔「"+p.name+"」與「"+partner.name+"」被分到不同隊，請調整。" };
        }
        if(sideP && !sideQ) (sideP === "left" ? forcedLeft : forcedRight).add(partner.id);
        if(sideQ && !sideP) (sideQ === "left" ? forcedLeft : forcedRight).add(p.id);
      }
    }

    if(forcedLeft.size > halfNeed) return { error: "左隊最多 "+halfNeed+" 人，請調整。" };
    if(forcedRight.size > halfNeed) return { error: "右隊最多 "+halfNeed+" 人，請調整。" };

    const forcedLeftIds = [...forcedLeft];
    const forcedRightIds = [...forcedRight];
    const forcedIds = new Set(forcedLeftIds.concat(forcedRightIds));
    const freePool = pool.filter(p=>!forcedIds.has(p.id));
    const leftNeed = halfNeed - forcedLeft.size;
    const rightNeed = halfNeed - forcedRight.size;
    const totalFillNeed = leftNeed + rightNeed;

    if(totalFillNeed === 0){
      return { teamA: forcedLeftIds, teamB: forcedRightIds };
    }

    const freeUnits = buildUnits(freePool, matchMode);
    let best = null, bestPenalty = Infinity;
    const attempts = 50;
    for(let i=0;i<attempts;i++){
      const shuffled = freeUnits.slice().sort((a,b)=> fairnessScore(a)-fairnessScore(b) || (Math.random()-0.5));
      let remaining = totalFillNeed;
      const filled = [];
      shuffled.forEach(u=>{
        if(u.size <= remaining){ filled.push(u); remaining -= u.size; }
      });
      if(remaining !== 0) continue;
      const split = packTwoSides(filled, leftNeed, rightNeed, Math.random() < 0.5);
      if(!split) continue;
      const teamA = forcedLeftIds.concat(split.left.flatMap(u=>u.members.map(m=>m.id)));
      const teamB = forcedRightIds.concat(split.right.flatMap(u=>u.members.map(m=>m.id)));
      let penalty = teamPenalty(teamA, teamB);
      // among players with equal games-played (real ties from fairnessScore), softly
      // prefer whoever has waited longer — but this no longer overrides skill balance
      // or repeat-avoidance the way an absolute wait-based sort key used to.
      filled.forEach(u=>{ penalty -= unitWaitScore(u) * 0.02; });
      if(penalty < bestPenalty){
        bestPenalty = penalty;
        best = { teamA, teamB };
      }
    }
    if(!best) return { error: "目前可上場人數不足或湊不出這一場，請調整名單或分隊。" };
    return best;
  }

  // ---------- Court management ----------
  document.getElementById("btn-add-court").addEventListener("click", ()=>{
    state.courts.push(makeCourt(state.nextCourtNumber));
    state.nextCourtNumber += 1;
    save();
    renderSchedule();
  });

  // Arms/disarms a court for removal — never deletes outright, so the action
  // can always be undone via "取消移除". A court with an active match is
  // actually removed once its score gets confirmed (see confirmScore); an
  // empty court needs the separate explicit "確定移除" to actually go away.
  function toggleCourtRemoval(courtIndex){
    const court = state.courts[courtIndex];
    court.retiring = !court.retiring;
    save();
    renderSchedule();
  }
  function confirmRemoveEmptyCourt(courtIndex){
    state.courts.splice(courtIndex, 1);
    save();
    renderSchedule();
  }

  // ---------- Match lifecycle ----------
  function applyHistoryCounts(matches, sign){
    sign = sign || 1;
    matches.forEach(m=>{
      [m.teamA, m.teamB].forEach(team=>{
        if(team.length===2){
          const k = pairKey(team[0], team[1]);
          state.pairHistory[k] = (state.pairHistory[k]||0) + sign;
          if(state.pairHistory[k] <= 0) delete state.pairHistory[k];
        }
      });
      m.teamA.forEach(x=>m.teamB.forEach(y=>{
        const k = pairKey(x,y);
        state.oppHistory[k] = (state.oppHistory[k]||0) + sign;
        if(state.oppHistory[k] <= 0) delete state.oppHistory[k];
      }));
    });
  }

  function assignPendingToCourt(pendingId, courtIndex){
    const court = state.courts[courtIndex];
    if(!court || court.currentMatch) return;
    const idx = state.pending.findIndex(m=>m.id === pendingId);
    if(idx < 0) return;
    const match = state.pending[idx];
    state.pending.splice(idx, 1);
    state.globalTick += 1;
    match.teamA.concat(match.teamB).forEach(id=>{
      const p = playerById(id);
      if(!p) return;
      p.lastPlayedTick = state.globalTick; // no longer "waiting" once play starts
      // gamesPlayed only counts once a score is actually confirmed (see confirmScore) —
      // a match abandoned mid-way via 中途下場 shouldn't count as played.
    });
    const newMatch = { matchId: uid(), teamA: match.teamA, teamB: match.teamB, scoreA:null, scoreB:null, done:false, winner:null };
    applyHistoryCounts([newMatch], 1);
    court.currentMatch = newMatch;
    court.roundNumber += 1;
    save();
    renderSchedule();
    renderPlayers();
  }

  function pushOrUpdateHistory(court, match){
    let entry = state.history.find(h=>h.matchId === match.matchId);
    if(!entry){
      entry = { matchId: match.matchId, ts: Date.now() };
      state.history.unshift(entry);
      if(state.history.length > 300) state.history.length = 300;
    }
    entry.courtLabel = "場地"+court.number;
    entry.roundNumber = court.roundNumber;
    entry.teamA = match.teamA.slice();
    entry.teamB = match.teamB.slice();
    entry.scoreA = match.scoreA;
    entry.scoreB = match.scoreB;
    entry.winner = match.winner;
  }

  function confirmScore(courtIndex, scoreA, scoreB){
    const court = state.courts[courtIndex];
    const m = court.currentMatch;
    if(!m) return;
    m.scoreA = scoreA; m.scoreB = scoreB;
    m.winner = scoreA > scoreB ? 'A' : 'B';
    m.done = true;
    const winners = m.winner === 'A' ? m.teamA : m.teamB;
    const losers = m.winner === 'A' ? m.teamB : m.teamA;
    winners.forEach(id=>{ const p = playerById(id); if(p){ p.wins += 1; p.gamesPlayed += 1; } });
    losers.forEach(id=>{ const p = playerById(id); if(p){ p.losses += 1; p.gamesPlayed += 1; } });
    pushOrUpdateHistory(court, m);
    court.currentMatch = null; // score confirmed -> court is released immediately
    if(court.retiring){
      const idx = state.courts.indexOf(court);
      if(idx >= 0) state.courts.splice(idx, 1);
    }
    save();
    renderSchedule();
    renderPlayers();
  }

  function abandonMatch(courtIndex){
    const court = state.courts[courtIndex];
    const m = court.currentMatch;
    if(!m) return;
    if(!confirm("確定要讓這場比賽中途下場嗎？（不會記錄比分與勝負，場地會立刻釋出）")) return;
    court.currentMatch = null;
    if(court.retiring){
      const idx = state.courts.indexOf(court);
      if(idx >= 0) state.courts.splice(idx, 1);
    }
    save();
    renderSchedule();
    renderPlayers();
  }

  // ---------- Pending-match builder UI ----------
  function startPendingBuild(){
    genUI = { matchMode: state.mode, teamOf: new Map(), editingId: null };
    renderSchedule();
  }
  function startEditPendingBuild(match){
    const teamOf = new Map();
    match.teamA.forEach(id=>teamOf.set(id,"left"));
    match.teamB.forEach(id=>teamOf.set(id,"right"));
    genUI = { matchMode: match.matchMode, teamOf, editingId: match.id };
    renderSchedule();
  }
  function cancelPendingBuild(){
    genUI = null;
    renderSchedule();
  }
  function confirmPendingBuild(){
    const { matchMode, teamOf, editingId } = genUI;
    const excludeIds = editingId ? [editingId] : [];
    const result = buildMatchFromSides(matchMode, teamOf, excludeIds);
    if(result.error){ alert(result.error); return; }
    if(editingId){
      const m = state.pending.find(x=>x.id === editingId);
      if(m){ m.matchMode = matchMode; m.teamA = result.teamA; m.teamB = result.teamB; }
    } else {
      state.pending.push({ id: uid(), matchMode, teamA: result.teamA, teamB: result.teamB });
    }
    state.mode = matchMode;
    genUI = null;
    save();
    renderSchedule();
  }

  // Resolves each pool player's side, folding in fixed partners that get
  // auto-pulled onto their partner's side in doubles (marked `auto:true`).
  // Only explicit ("random"/"left"/"right" picks) actually live in
  // genUI.teamOf — the auto entries are derived fresh on every render, so
  // setting the anchor player back to "random" immediately frees the partner.
  function effectiveAssignments(pool){
    const map = new Map();
    pool.forEach(p=>{
      const side = genUI.teamOf.get(p.id);
      if(side) map.set(p.id, { side, auto:false });
    });
    if(genUI.matchMode === "doubles"){
      const poolIds = new Set(pool.map(p=>p.id));
      [...map.entries()].forEach(([id, entry])=>{
        const p = playerById(id);
        if(!p || !p.fixedPartnerId || !poolIds.has(p.fixedPartnerId)) return;
        if(!map.has(p.fixedPartnerId)){
          map.set(p.fixedPartnerId, { side: entry.side, auto:true });
        }
      });
    }
    return map;
  }
  // how many of a side's slots player p would take up if assigned there —
  // 2 when they have a fixed partner also in the pool (doubles pulls the
  // partner along), 1 otherwise.
  function unitSize(p, poolIds){
    return (genUI.matchMode === "doubles" && p.fixedPartnerId && poolIds.has(p.fixedPartnerId)) ? 2 : 1;
  }

  function renderTeamsPreview(halfNeed, pool, effMap){
    const leftIds = [], rightIds = [];
    pool.forEach(p=>{
      const eff = effMap.get(p.id);
      if(eff && eff.side === "left") leftIds.push(p.id);
      else if(eff && eff.side === "right") rightIds.push(p.id);
    });
    const wrap = document.createElement("div");
    wrap.className = "teams";
    function teamBox(cls, label, ids){
      const box = document.createElement("div");
      box.className = "team " + cls;
      let html = `<div class="muted" style="margin-bottom:4px;font-weight:700;">${label} ${ids.length}/${halfNeed}</div>`;
      if(ids.length){
        html += ids.map(id=>`<div class="p">${playerChip(id)}</div>`).join("");
      }
      if(ids.length < halfNeed){
        html += `<div class="muted" style="font-size:12px;">（尚有 ${halfNeed-ids.length} 位待補，確認後自動安排）</div>`;
      }
      box.innerHTML = html;
      return box;
    }
    wrap.appendChild(teamBox("a", "左隊", leftIds));
    const vs = document.createElement("div");
    vs.className = "vs";
    vs.textContent = "VS";
    wrap.appendChild(vs);
    wrap.appendChild(teamBox("b", "右隊", rightIds));
    return wrap;
  }

  function renderGenerationPanel(){
    const halfNeed = (genUI.matchMode === "doubles" ? 4 : 2) / 2;
    const isEditing = !!genUI.editingId;
    const excludeIds = isEditing ? [genUI.editingId] : [];
    const pool = orderWithPartnerGrouping(eligiblePoolForPending(excludeIds));
    const panel = document.createElement("div");
    panel.className = "gen-panel";

    const heading = document.createElement("div");
    heading.className = "muted";
    heading.style.marginBottom = "8px";
    heading.style.fontWeight = "700";
    heading.textContent = isEditing ? "修改預排的這一輪" : "預排新的一輪";
    panel.appendChild(heading);

    const modeField = document.createElement("div");
    modeField.className = "field";
    modeField.style.marginBottom = "10px";
    const modeLabel = document.createElement("label");
    modeLabel.textContent = "比賽模式";
    const modeSelect = document.createElement("select");
    [["doubles","雙打 (4人一場)"],["singles","單打 (2人一場)"]].forEach(([val,label])=>{
      const opt = document.createElement("option");
      opt.value = val; opt.textContent = label;
      if(genUI.matchMode === val) opt.selected = true;
      modeSelect.appendChild(opt);
    });
    modeSelect.addEventListener("change", ()=>{
      genUI.matchMode = modeSelect.value;
      genUI.teamOf.clear();
      renderSchedule();
    });
    modeField.appendChild(modeLabel);
    modeField.appendChild(modeSelect);
    panel.appendChild(modeField);

    const poolIds = new Set(pool.map(p=>p.id));
    const effMap = effectiveAssignments(pool);
    let leftCount = 0, rightCount = 0;
    effMap.forEach(({side})=>{ if(side === "left") leftCount++; else if(side === "right") rightCount++; });

    panel.appendChild(renderTeamsPreview(halfNeed, pool, effMap));

    const list = document.createElement("div");
    list.className = "pick-list";
    if(!pool.length){
      list.innerHTML = '<div class="muted">目前沒有可選的球員（需已報到、未休息／離場，且未在場上或已被預排）。</div>';
    }
    pool.forEach(p=>{
      const row = document.createElement("div");
      row.className = "pick-row";
      const info = document.createElement("span");
      info.className = "info player-cols";
      info.innerHTML = playerColumnsHtml(p);
      row.appendChild(info);
      const toggle = document.createElement("div");
      toggle.className = "team-toggle";
      const eff = effMap.get(p.id);
      const isAuto = !!(eff && eff.auto);
      const current = isAuto ? eff.side : (genUI.teamOf.get(p.id) || "random");
      const size = unitSize(p, poolIds);
      const remaining = { left: halfNeed - leftCount, right: halfNeed - rightCount };
      [["random","隨機"],["left","左隊"],["right","右隊"]].forEach(([val,label])=>{
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        if(current === val) b.classList.add("active");
        let disabled = false;
        if(isAuto){
          disabled = true; // controlled entirely by the anchor partner
        } else if(val !== "random" && val !== current){
          disabled = size > remaining[val];
        }
        if(disabled) b.disabled = true;
        if(isAuto) b.title = "搭檔已被指定上場，跟著一起入隊；把搭檔改回「隨機」才能單獨調整";
        else if(disabled) b.title = "這隊人數已滿，請先讓其他人讓出名額";
        b.addEventListener("click", ()=>{
          if(disabled) return;
          if(val === "random") genUI.teamOf.delete(p.id);
          else genUI.teamOf.set(p.id, val);
          renderSchedule();
        });
        toggle.appendChild(b);
      });
      row.appendChild(toggle);
      list.appendChild(row);
    });
    panel.appendChild(list);

    const noteInfo = document.createElement("div");
    noteInfo.className = "muted";
    noteInfo.style.margin = "8px 0";
    noteInfo.textContent = "留「隨機」的人由系統自動決定要不要上場、上哪一隊；指定「左隊」「右隊」的人一定照指定上場。";
    panel.appendChild(noteInfo);

    const actionRow = document.createElement("div");
    actionRow.className = "row";
    const confirmBtn = document.createElement("button");
    confirmBtn.className = "btn small";
    confirmBtn.textContent = isEditing ? "確認修改" : "確認預排";
    confirmBtn.addEventListener("click", confirmPendingBuild);
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn secondary small";
    cancelBtn.textContent = "取消";
    cancelBtn.addEventListener("click", cancelPendingBuild);
    actionRow.appendChild(confirmBtn);
    actionRow.appendChild(cancelBtn);
    panel.appendChild(actionRow);

    return panel;
  }

  // player info laid out as aligned columns: 姓名 | 程度 | 上場數 | 搭檔
  // (no headers — just consistent spacing so rows read like a table)
  function playerColumnsHtml(p){
    const partner = p.fixedPartnerId ? playerById(p.fixedPartnerId) : null;
    return `
      <span class="col-name">${escapeHtml(p.name)}</span>
      <span class="col-skill muted">${skillDisplay(p.skill)}</span>
      <span class="col-games muted">${p.gamesPlayed}場</span>
      <span class="col-partner muted">${partner ? "- "+escapeHtml(partner.name) : ""}</span>
    `;
  }

  // sorts players by games played asc, then skill asc — keeping fixed-partner
  // pairs adjacent, anchored at whichever partner has the lower skill (the
  // other partner is placed right after, regardless of their own stats).
  // Only pairs where both members are present in `players` are grouped.
  function orderWithPartnerGrouping(players){
    const sorted = players.slice().sort((a,b)=> a.gamesPlayed - b.gamesPlayed || a.skill - b.skill);
    const byId = new Map(sorted.map(p=>[p.id, p]));
    const consumed = new Set();
    const ordered = [];
    sorted.forEach(p=>{
      if(consumed.has(p.id)) return;
      const partner = p.fixedPartnerId ? byId.get(p.fixedPartnerId) : null;
      if(partner && !consumed.has(partner.id)){
        const selfIsAnchor = p.skill < partner.skill ||
          (p.skill === partner.skill && p.gamesPlayed <= partner.gamesPlayed);
        if(!selfIsAnchor) return; // will be emitted right after its anchor
        ordered.push(p, partner);
        consumed.add(p.id); consumed.add(partner.id);
      } else {
        ordered.push(p);
        consumed.add(p.id);
      }
    });
    return ordered;
  }

  // ---------- Schedule tab rendering ----------
  function playerChip(id){
    const p = playerById(id);
    if(!p) return "";
    const fixedTag = p.fixedPartnerId ? '<span class="badge-fixed">固定</span>' : "";
    return `<span class="nm">${escapeHtml(p.name)} <span class="muted">${skillDisplay(p.skill)}</span>${fixedTag}</span>`;
  }

  function teamsHtml(m){
    let resultLine = "";
    if(m.done){
      const teamAName = m.teamA.map(id=>playerById(id)?.name||"?").join(" / ");
      const teamBName = m.teamB.map(id=>playerById(id)?.name||"?").join(" / ");
      const winName = m.winner === 'A' ? teamAName : teamBName;
      resultLine = `<div class="muted">比分 ${m.scoreA} : ${m.scoreB}　${escapeHtml(winName)} 勝</div>`;
    }
    return `
      <div class="teams">
        <div class="team a">${m.teamA.map(id=>`<div class="p">${playerChip(id)}</div>`).join("")}</div>
        <div class="vs">VS</div>
        <div class="team b">${m.teamB.map(id=>`<div class="p">${playerChip(id)}</div>`).join("")}</div>
      </div>
      ${resultLine}
    `;
  }

  function renderScoreRow(index){
    const row = document.createElement("div");
    row.className = "score-input-row";
    const scoreA = document.createElement("input");
    scoreA.type = "number"; scoreA.min = "0"; scoreA.placeholder = "左比分";
    const sep = document.createElement("span");
    sep.textContent = ":";
    const scoreB = document.createElement("input");
    scoreB.type = "number"; scoreB.min = "0"; scoreB.placeholder = "右比分";
    const btn = document.createElement("button");
    btn.className = "btn small";
    btn.textContent = "確認比分";
    btn.addEventListener("click", ()=>{
      const a = parseInt(scoreA.value, 10);
      const b = parseInt(scoreB.value, 10);
      if(isNaN(a) || isNaN(b) || a < 0 || b < 0){ alert("請輸入兩隊比分"); return; }
      if(a === b){ alert("比分不可相同，請確認"); return; }
      confirmScore(index, a, b);
    });
    const abandonBtn = document.createElement("button");
    abandonBtn.className = "btn danger small";
    abandonBtn.textContent = "中途下場";
    abandonBtn.style.marginLeft = "auto";
    abandonBtn.addEventListener("click", ()=> abandonMatch(index));
    row.appendChild(scoreA); row.appendChild(sep); row.appendChild(scoreB); row.appendChild(btn);
    row.appendChild(abandonBtn);
    return row;
  }

  function renderCourtCard(court, index){
    const div = document.createElement("div");
    div.className = "court card" + (court.retiring ? " retiring" : "");
    const m = court.currentMatch;

    const head = document.createElement("div");
    head.className = "court-head";
    const label = document.createElement("span");
    label.className = "muted";
    label.textContent = "場地";
    head.appendChild(label);
    const numberText = document.createElement("span");
    numberText.className = "court-number-text";
    numberText.textContent = court.number;
    head.appendChild(numberText);
    const numberInput = document.createElement("input");
    numberInput.className = "court-number-input";
    numberInput.value = court.number;
    numberInput.hidden = true;
    head.appendChild(numberInput);
    const numberEditBtn = document.createElement("button");
    function setNumberEditIdle(){
      numberEditBtn.className = "btn secondary small icon-btn";
      numberEditBtn.innerHTML = iconSvg("pencil");
      numberEditBtn.title = "修改場地名稱"; numberEditBtn.setAttribute("aria-label", "修改場地名稱");
    }
    function confirmNumberEdit(){
      court.number = numberInput.value.trim() || court.number;
      numberText.textContent = court.number;
      numberInput.value = court.number;
      numberInput.hidden = true;
      numberText.hidden = false;
      setNumberEditIdle();
      save();
      renderSchedule();
    }
    setNumberEditIdle();
    numberEditBtn.addEventListener("click", ()=>{
      if(numberInput.hidden){
        numberText.hidden = true;
        numberInput.hidden = false;
        numberInput.focus();
        numberInput.select();
        numberEditBtn.className = "btn success small icon-btn";
        numberEditBtn.innerHTML = iconSvg("check");
        numberEditBtn.title = "確定"; numberEditBtn.setAttribute("aria-label", "確定");
      } else {
        confirmNumberEdit();
      }
    });
    numberInput.addEventListener("keydown", (e)=>{
      if(e.key === "Enter"){ e.preventDefault(); confirmNumberEdit(); }
    });
    head.appendChild(numberEditBtn);
    const played = document.createElement("span");
    played.className = "muted";
    played.textContent = "已進行 "+court.roundNumber+" 場";
    head.appendChild(played);
    if(court.retiring){
      const tag = document.createElement("span");
      tag.className = "badge-retiring";
      tag.textContent = m ? "最後一場" : "即將移除";
      head.appendChild(tag);
    }
    const removeBtn = document.createElement("button");
    removeBtn.className = (court.retiring ? "btn secondary small icon-btn" : "btn danger small icon-btn") + " court-remove-btn";
    removeBtn.innerHTML = iconSvg(court.retiring ? "undo" : "trash");
    removeBtn.title = court.retiring ? "取消移除" : "移除";
    removeBtn.setAttribute("aria-label", removeBtn.title);
    removeBtn.addEventListener("click", ()=> toggleCourtRemoval(index));
    head.appendChild(removeBtn);
    if(court.retiring && !m){
      const confirmBtn = document.createElement("button");
      confirmBtn.className = "btn danger small";
      confirmBtn.textContent = "確定移除";
      confirmBtn.addEventListener("click", ()=> confirmRemoveEmptyCourt(index));
      head.appendChild(confirmBtn);
    }
    div.appendChild(head);

    if(m){
      const teamsWrap = document.createElement("div");
      teamsWrap.innerHTML = teamsHtml(m);
      div.appendChild(teamsWrap);
      div.appendChild(renderScoreRow(index));
    } else if(court.retiring){
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "此場地即將移除，按「確定移除」立即移除，或「取消移除」保留。";
      div.appendChild(empty);
    } else {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "空場地，可在下方「下一輪預排」指派球員入場。";
      div.appendChild(empty);
    }

    return div;
  }

  function renderPendingCard(){
    const wrap = document.getElementById("pending-list");
    wrap.innerHTML = "";
    document.getElementById("pending-empty").style.display = state.pending.length ? "none" : "block";
    const freeCourts = state.courts.map((c,i)=>({c,i})).filter(x=>!x.c.currentMatch);
    state.pending.forEach(match=>{
      if(genUI && genUI.editingId === match.id) return; // being edited below, don't show twice
      const div = document.createElement("div");
      div.className = "court";
      const teamsWrap = document.createElement("div");
      teamsWrap.innerHTML = teamsHtml(match);
      div.appendChild(teamsWrap);

      const actionRow = document.createElement("div");
      actionRow.className = "row pending-actions";
      if(freeCourts.length){
        const select = document.createElement("select");
        select.style.width = "auto";
        freeCourts.forEach(({c,i})=>{
          const opt = document.createElement("option");
          opt.value = i; opt.textContent = "場地 "+c.number;
          select.appendChild(opt);
        });
        const assignBtn = document.createElement("button");
        assignBtn.className = "btn small";
        assignBtn.textContent = "指派上場";
        assignBtn.addEventListener("click", ()=>{
          assignPendingToCourt(match.id, parseInt(select.value, 10));
        });
        actionRow.appendChild(select);
        actionRow.appendChild(assignBtn);
      } else {
        const note = document.createElement("span");
        note.className = "muted";
        note.textContent = "目前沒有空場地，等場地釋出後才能指派上場";
        actionRow.appendChild(note);
      }
      const modifyBtn = document.createElement("button");
      modifyBtn.className = "btn secondary small";
      modifyBtn.textContent = "修改";
      modifyBtn.addEventListener("click", ()=> startEditPendingBuild(match));
      actionRow.appendChild(modifyBtn);

      const removeBtn = document.createElement("button");
      removeBtn.className = "btn danger small";
      removeBtn.textContent = "移除";
      removeBtn.addEventListener("click", ()=>{
        if(!confirm("確定要移除這個預排的輪次嗎？")) return;
        state.pending = state.pending.filter(m=>m.id !== match.id);
        save();
        renderSchedule();
      });
      actionRow.appendChild(removeBtn);
      div.appendChild(actionRow);
      wrap.appendChild(div);
    });

    const builderSlot = document.getElementById("pending-builder");
    builderSlot.innerHTML = "";
    if(genUI) builderSlot.appendChild(renderGenerationPanel());
  }

  function renderWaitingList(){
    const wrap = document.getElementById("waiting-list");
    wrap.innerHTML = "";
    const onCourt = new Set();
    state.courts.forEach(c=>{
      if(c.currentMatch){
        c.currentMatch.teamA.forEach(id=>onCourt.add(id));
        c.currentMatch.teamB.forEach(id=>onCourt.add(id));
      }
    });
    const pendingIds = new Set();
    state.pending.forEach(m=>{
      m.teamA.forEach(id=>pendingIds.add(id));
      m.teamB.forEach(id=>pendingIds.add(id));
    });
    const entries = [];
    state.players.forEach(p=>{
      if(p.removed || onCourt.has(p.id) || !p.checkedIn) return;
      let label, cls;
      if(pendingIds.has(p.id)){ label = "已預排"; cls = "pending"; }
      else if(p.left){ label = "離場"; cls = "leave"; }
      else if(p.resting){ label = "休息"; cls = "rest"; }
      else { label = "候補"; cls = "bench"; }
      entries.push({ p, label, cls });
    });
    const entryById = new Map(entries.map(e=>[e.p.id, e]));
    const ordered = orderWithPartnerGrouping(entries.map(e=>e.p)).map(p=>entryById.get(p.id));

    document.getElementById("waiting-empty").style.display = ordered.length ? "none":"block";
    ordered.forEach(({p, label, cls})=>{
      const row = document.createElement("div");
      row.className = "bench-row";
      const info = document.createElement("span");
      info.className = "player-cols";
      info.innerHTML = playerColumnsHtml(p);
      const tag = document.createElement("span");
      tag.className = "bench-tag " + cls;
      tag.textContent = label;
      row.appendChild(info);
      row.appendChild(tag);
      wrap.appendChild(row);
    });
  }

  function renderSchedule(){
    const container = document.getElementById("courts-container");
    container.innerHTML = "";
    state.courts.forEach((court, idx)=>{
      container.appendChild(renderCourtCard(court, idx));
    });
    renderPendingCard();
    renderWaitingList();
  }

  document.getElementById("btn-build-pending").addEventListener("click", startPendingBuild);

  // ---------- Stats tab ----------
  function renderStats(){
    const tbody = document.getElementById("stats-table-body");
    tbody.innerHTML = "";
    const list = state.players.filter(p=>!p.removed)
      .slice()
      .sort((a,b)=> b.gamesPlayed - a.gamesPlayed);
    list.forEach(p=>{
      const total = p.wins + p.losses;
      const rate = total ? Math.round(p.wins/total*100)+"%" : "—";
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(p.name)}</td><td>${p.gamesPlayed}</td><td>${p.wins}</td><td>${p.losses}</td><td>${rate}</td>`;
      tbody.appendChild(tr);
    });

    const histWrap = document.getElementById("history-list");
    histWrap.innerHTML = "";
    document.getElementById("history-empty").style.display = state.history.length ? "none":"block";
    state.history.forEach(h=>{
      const div = document.createElement("div");
      div.className = "court";
      const a = h.teamA.map(id=>playerById(id)?.name||"?").join("/");
      const b = h.teamB.map(id=>playerById(id)?.name||"?").join("/");
      const winName = h.winner === 'A' ? a : b;
      div.innerHTML = `<h3><span>${h.courtLabel} · 第 ${h.roundNumber} 場</span></h3>
        <div class="muted" style="font-size:13px;line-height:1.6">${a} vs ${b} － 比分 ${h.scoreA}:${h.scoreB}，${escapeHtml(winName)} 勝</div>`;
      histWrap.appendChild(div);
    });
  }

  document.getElementById("btn-reset-stats").addEventListener("click", ()=>{
    if(!confirm("確定要清除所有上場次數、勝負與歷史紀錄嗎？球員名單會保留。")) return;
    resetParticipationOnly();
    save();
    renderPlayers(); renderSchedule(); renderStats();
  });

  document.getElementById("btn-export-record").addEventListener("click", ()=>{
    const lines = [];
    lines.push("# 球員統計");
    lines.push(["姓名","上場","勝","負","勝率"].join(","));
    state.players.filter(p=>!p.removed).forEach(p=>{
      const total = p.wins + p.losses;
      const rate = total ? Math.round(p.wins/total*100)+"%" : "";
      lines.push([p.name, p.gamesPlayed, p.wins, p.losses, rate].join(","));
    });
    lines.push("");
    lines.push("# 歷史紀錄");
    lines.push(["場地","場次","左隊","右隊","比分","勝方"].join(","));
    state.history.forEach(h=>{
      const a = h.teamA.map(id=>playerById(id)?.name||"?").join("/");
      const b = h.teamB.map(id=>playerById(id)?.name||"?").join("/");
      const win = h.winner === 'A' ? a : b;
      lines.push([h.courtLabel, h.roundNumber, a, b, h.scoreA+":"+h.scoreB, win].join(","));
    });
    const blob = new Blob([lines.join("\n")], {type:"text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0,10);
    a.href = url; a.download = "record-"+stamp+".csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  });

  // ---------- 主題切換（系統 / 淺色 / 深色） ----------
  const THEME_KEY = "badminton_scheduler_theme";
  const THEME_ICONS = {
    system: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z"/><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/></svg>',
    light: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>',
    dark: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>'
  };
  const THEME_ORDER = ["system","light","dark"];
  let themePref = "system";

  function loadThemePref(){
    try{
      const v = localStorage.getItem(THEME_KEY);
      return THEME_ORDER.includes(v) ? v : "system";
    }catch(e){ return "system"; }
  }
  function applyTheme(){
    const effective = themePref === "system"
      ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : themePref;
    document.documentElement.setAttribute("data-theme", effective);
    const btn = document.getElementById("btn-theme-toggle");
    if(btn) btn.innerHTML = THEME_ICONS[themePref];
  }
  function initTheme(){
    themePref = loadThemePref();
    applyTheme();
    const btn = document.getElementById("btn-theme-toggle");
    if(btn){
      btn.addEventListener("click", ()=>{
        const idx = THEME_ORDER.indexOf(themePref);
        themePref = THEME_ORDER[(idx+1) % THEME_ORDER.length];
        try{ localStorage.setItem(THEME_KEY, themePref); }catch(e){}
        applyTheme();
      });
    }
    if(window.matchMedia){
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", ()=>{
        if(themePref === "system") applyTheme();
      });
    }
  }

  // ---------- init ----------
  initTheme();
  renderPlayers();
  renderSchedule();
})();
