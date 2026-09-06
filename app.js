(function(){
  "use strict";
  const STORAGE_KEY = "badminton_scheduler_state_v2";

  function uid(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

  function makeCourt(){
    return { id: uid(), roundNumber: 0, currentMatch: null, retiring: false };
  }

  function defaultState(){
    return {
      players: [],       // {id,name,skill,fixedPartnerId,checkedIn,resting,left,removed,gamesPlayed,wins,losses,lastPlayedTick}
      courtCount: 2,
      mode: "doubles",   // doubles | singles
      courts: [makeCourt(), makeCourt()],
      globalTick: 0,
      pairHistory: {},   // "id1|id2" (sorted) -> times partnered
      oppHistory: {},    // "id1|id2" (sorted) -> times opposed
      history: []        // finished matches: {matchId, ts, courtLabel, roundNumber, teamA, teamB, scoreA, scoreB, winner}
    };
  }

  let state = load();
  let selectionUI = null; // { courtIndex, matchMode:'doubles'|'singles', teamOf:Map(id->'left'|'right'), advanceRound }

  function load(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return Object.assign(defaultState(), parsed);
    }catch(e){
      console.error("load failed", e);
      return defaultState();
    }
  }
  function save(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function eligiblePlayers(){
    return state.players.filter(p => !p.removed && p.checkedIn && !p.resting && !p.left);
  }
  function playerById(id){ return state.players.find(p => p.id === id); }
  function pairKey(a,b){ return [a,b].sort().join("|"); }

  function skillDisplay(skill){ return skill >= 13 ? "12以上" : ("Lv"+skill); }
  function skillCell(skill){ return skill >= 13 ? "12以上" : String(skill); }

  // ---------- Tabs ----------
  document.querySelectorAll("nav.tabs button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll("nav.tabs button").forEach(b=>b.classList.remove("active"));
      document.querySelectorAll("section.tab").forEach(s=>s.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-"+btn.dataset.tab).classList.add("active");
      if(btn.dataset.tab === "stats") renderStats();
      if(btn.dataset.tab === "schedule") renderSchedule();
      if(btn.dataset.tab === "roster"){ renderPlayers(); renderSettings(); }
    });
  });

  // ---------- Players tab ----------
  function refreshPartnerSelect(){
    const sel = document.getElementById("np-partner");
    sel.innerHTML = '<option value="">— 無 —</option>';
    state.players.forEach(p=>{
      if(p.removed) return;
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
  }

  function makePlayer(name, skill, checkedIn){
    return { id: uid(), name, skill, fixedPartnerId: null,
      checkedIn: !!checkedIn, resting: false, left: false, removed: false,
      gamesPlayed: 0, wins: 0, losses: 0, lastPlayedTick: 0 };
  }

  document.getElementById("btn-add-player").addEventListener("click", ()=>{
    const nameEl = document.getElementById("np-name");
    const name = nameEl.value.trim();
    if(!name){ nameEl.focus(); return; }
    const skill = parseInt(document.getElementById("np-skill").value, 10);
    const partnerId = document.getElementById("np-partner").value || null;
    const p = makePlayer(name, skill, true);
    p.fixedPartnerId = partnerId;
    state.players.push(p);
    if(partnerId){
      const partner = playerById(partnerId);
      if(partner) partner.fixedPartnerId = p.id; // mutual link
    }
    nameEl.value = "";
    save();
    renderPlayers();
  });

  // ---------- Roster CSV (space-delimited): 姓名 程度 搭檔 ----------
  function parseSkillToken(tok){
    if(tok === "12+" || tok === "12以上") return 13;
    if(/^([1-9]|1[0-2])$/.test(tok)) return parseInt(tok, 10);
    return null;
  }

  function parseRosterLine(line){
    const parts = line.trim().split(/\s+/);
    if(!parts.length || !parts[0]) return null;
    const name = parts[0];
    let skill = 6;
    if(parts[1]){
      const s = parseSkillToken(parts[1]);
      if(s) skill = s;
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
  // page's batch-add box and the "開新場" modal's batch box / CSV import)
  function addRosterFromText(text, checkedIn){
    const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(l=>l && !l.startsWith("#"));
    const added = [];
    lines.forEach(line=>{
      const parsed = parseRosterLine(line);
      if(!parsed) return;
      const p = makePlayer(parsed.name, parsed.skill, checkedIn);
      state.players.push(p);
      added.push({ player:p, partnerName: parsed.partnerName });
    });
    linkPartnersByName(added);
    return added;
  }

  document.getElementById("btn-bulk-add").addEventListener("click", ()=>{
    const raw = document.getElementById("bulk-text").value;
    if(!raw.trim()) return;
    const added = addRosterFromText(raw, true);
    document.getElementById("bulk-text").value = "";
    save();
    renderPlayers();
    alert("已新增 "+added.length+" 位球員");
  });

  document.getElementById("btn-export").addEventListener("click", ()=>{
    const lines = ["# 姓名 程度 搭檔"];
    state.players.filter(p=>!p.removed).forEach(p=>{
      const partner = p.fixedPartnerId ? playerById(p.fixedPartnerId) : null;
      const skillTok = p.skill >= 13 ? "12+" : p.skill;
      lines.push([p.name, skillTok, partner ? partner.name : "-"].join(" "));
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
        const added = addRosterFromText(reader.result, true);
        resetParticipationOnly();
        save();
        renderPlayers(); renderSettings(); renderSchedule(); renderStats();
        alert("匯入成功，共 "+added.length+" 位球員");
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

  function renderPlayers(){
    refreshPartnerSelect();
    const tbody = document.getElementById("player-table-body");
    tbody.innerHTML = "";
    const visible = state.players.filter(p=>!p.removed);
    document.getElementById("player-empty").style.display = visible.length ? "none":"block";
    document.getElementById("player-count").textContent = visible.length ? "（共 "+visible.length+" 人）" : "";
    visible.forEach(p=>{
      const tr = document.createElement("tr");
      const partner = p.fixedPartnerId ? playerById(p.fixedPartnerId) : null;
      tr.innerHTML = `
        <td>${escapeHtml(p.name)}</td>
        <td><span class="skill">${skillCell(p.skill)}</span></td>
        <td>${partner ? escapeHtml(partner.name) : '<span class="muted">—</span>'}</td>
        <td></td>
        <td>${p.gamesPlayed}</td>
        <td></td>
      `;
      tr.children[3].appendChild(renderStatusButtons(p));
      const actionsTd = tr.querySelector("td:last-child");
      const delBtn = document.createElement("button");
      delBtn.className = "btn danger small";
      delBtn.textContent = "刪除";
      delBtn.addEventListener("click", ()=>{
        if(!confirm("確定要刪除「"+p.name+"」嗎？")) return;
        if(p.fixedPartnerId){
          const partner = playerById(p.fixedPartnerId);
          if(partner) partner.fixedPartnerId = null;
        }
        p.removed = true;
        save(); renderPlayers();
      });
      actionsTd.appendChild(delBtn);
      tbody.appendChild(tr);
    });
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  // ---------- Court settings ----------
  function courtIsFree(court){
    return !court.currentMatch || court.currentMatch.done;
  }

  function applyCourtCount(newCount){
    for(let i = state.courts.length - 1; i >= newCount; i--){
      if(courtIsFree(state.courts[i])){
        state.courts.splice(i, 1);
      } else {
        state.courts[i].retiring = true;
      }
    }
    while(state.courts.length < newCount){
      state.courts.push(makeCourt());
    }
    state.courtCount = newCount;
  }

  function renderSettings(){
    document.getElementById("s-courts").value = state.courtCount;
    document.getElementById("s-mode").value = state.mode;
    updateSettingsEcho();
    const retiringCount = state.courts.filter(c=>c.retiring).length;
    const noteEl = document.getElementById("s-retiring-note");
    if(retiringCount > 0){
      noteEl.style.display = "block";
      noteEl.textContent = "目前有 "+retiringCount+" 片場地正在收尾（最後一輪確認比分後會自動移除）。";
    } else {
      noteEl.style.display = "none";
    }
  }
  function updateSettingsEcho(){
    const courts = parseInt(document.getElementById("s-courts").value,10) || 1;
    const mode = document.getElementById("s-mode").value;
    const need = mode === "doubles" ? 4 : 2;
    document.getElementById("s-need").textContent = need;
    document.getElementById("s-courts-echo").textContent = courts;
    document.getElementById("s-total").textContent = need * courts;
  }
  document.getElementById("s-courts").addEventListener("input", updateSettingsEcho);
  document.getElementById("s-mode").addEventListener("change", updateSettingsEcho);
  document.getElementById("btn-save-settings").addEventListener("click", ()=>{
    const newCount = Math.max(1, parseInt(document.getElementById("s-courts").value,10) || 1);
    applyCourtCount(newCount);
    state.mode = document.getElementById("s-mode").value;
    save();
    renderSettings();
    renderSchedule();
    alert("設定已儲存");
  });

  // ---------- 開新場 modal ----------
  const modalOverlay = document.getElementById("modal-overlay");

  function openModal(){
    document.getElementById("modal-courts").value = state.courtCount;
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

  function startNewSession(newCourtCount, newMode){
    state.players.forEach(p=>{
      p.checkedIn = false; p.resting = false; p.left = false;
      p.gamesPlayed = 0; p.wins = 0; p.losses = 0; p.lastPlayedTick = 0;
    });
    state.courtCount = newCourtCount;
    state.mode = newMode;
    state.courts = [];
    for(let i=0;i<newCourtCount;i++) state.courts.push(makeCourt());
    state.globalTick = 0;
    state.pairHistory = {};
    state.oppHistory = {};
    state.history = [];
  }

  function resetParticipationOnly(){
    state.players.forEach(p=>{ p.gamesPlayed=0; p.wins=0; p.losses=0; p.lastPlayedTick=0; });
    state.courts = state.courts.map(()=>makeCourt());
    state.globalTick = 0;
    state.pairHistory = {};
    state.oppHistory = {};
    state.history = [];
  }

  function finishOpeningSession(){
    const bulkText = document.getElementById("modal-bulk-text").value;
    if(bulkText.trim()) addRosterFromText(bulkText, false);
    const newCourtCount = Math.max(1, parseInt(document.getElementById("modal-courts").value,10) || 1);
    const newMode = document.getElementById("modal-mode").value;
    startNewSession(newCourtCount, newMode);
    save();
    renderPlayers(); renderSettings(); renderStats();
    closeModal();
    document.querySelector('nav.tabs button[data-tab="schedule"]').click();
  }

  document.getElementById("modal-start-btn").addEventListener("click", ()=>{
    const anyProgress = state.courts.some(c=>c.currentMatch) || state.history.length > 0;
    if(anyProgress){
      if(!confirm("開新場會清除目前的上場次數、比分與歷史紀錄（球員名單會保留），確定要開始新的一場嗎？")) return;
    }
    const file = document.getElementById("modal-file-import").files[0];
    if(file){
      const reader = new FileReader();
      reader.onload = ()=>{
        const lines = reader.result.split(/\r?\n/).map(l=>l.trim()).filter(l=>l && !l.startsWith("#"));
        if(lines.length){
          state.players = [];
          addRosterFromText(reader.result, false);
        }
        finishOpeningSession();
      };
      reader.readAsText(file);
    } else {
      finishOpeningSession();
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
    const gp = Math.min(...unit.members.map(m=>m.gamesPlayed));
    const waited = state.globalTick - Math.max(...unit.members.map(m=>m.lastPlayedTick));
    return gp * 1000 - waited; // fewer games played first; among ties, longer-waited first
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

  // fills two same-court "bins" (left/right) of given capacity from `units` (size 1 or 2),
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

  // Builds one court's match from a per-player left/right/(random) assignment: players
  // pinned to "left"/"right" (and their fixed partner, auto-pulled to the same side) are
  // guaranteed a spot on that side; every remaining ("random") slot on either side is
  // filled automatically from the rest of the eligible pool, balancing skill and avoiding
  // recent repeat opponents/partners. Leaving everyone on "random" reproduces the old
  // fully-automatic behavior; pinning everyone reproduces fully-manual.
  function buildMatchFromSides(courtIndex, matchMode, teamOf){
    const need = matchMode === "doubles" ? 4 : 2;
    const halfNeed = need / 2;
    const pool = eligiblePoolForCourt(courtIndex);
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
      const penalty = teamPenalty(teamA, teamB);
      if(penalty < bestPenalty){
        bestPenalty = penalty;
        best = { teamA, teamB };
        if(penalty === 0) break;
      }
    }
    if(!best) return { error: "目前可上場人數不足或湊不出這一場，請調整名單或分隊。" };
    return best;
  }

  function eligiblePoolForCourt(courtIndex){
    const occupied = new Set();
    state.courts.forEach((c,i)=>{
      if(i === courtIndex) return;
      if(c.currentMatch){
        c.currentMatch.teamA.forEach(id=>occupied.add(id));
        c.currentMatch.teamB.forEach(id=>occupied.add(id));
      }
    });
    return eligiblePlayers().filter(p=>!occupied.has(p.id));
  }

  // ---------- Court match lifecycle ----------
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

  function revertMatchCounts(match){
    match.teamA.concat(match.teamB).forEach(id=>{
      const p = playerById(id);
      if(p) p.gamesPlayed = Math.max(0, p.gamesPlayed - 1);
    });
    applyHistoryCounts([match], -1);
  }

  function applyMatchToCourt(courtIndex, teamA, teamB, advanceRound){
    const court = state.courts[courtIndex];
    if(court.currentMatch && !court.currentMatch.done){
      revertMatchCounts(court.currentMatch);
    }
    state.globalTick += 1;
    teamA.concat(teamB).forEach(id=>{
      const p = playerById(id);
      p.gamesPlayed += 1;
      p.lastPlayedTick = state.globalTick;
    });
    const newMatch = { matchId: uid(), teamA, teamB, scoreA:null, scoreB:null, done:false, winner:null };
    applyHistoryCounts([newMatch], 1);
    court.currentMatch = newMatch;
    if(advanceRound || !court.roundNumber) court.roundNumber += 1;
    save();
  }

  function pushOrUpdateHistory(courtIndex, court, match){
    let entry = state.history.find(h=>h.matchId === match.matchId);
    if(!entry){
      entry = { matchId: match.matchId, ts: Date.now() };
      state.history.unshift(entry);
      if(state.history.length > 300) state.history.length = 300;
    }
    entry.courtLabel = "場地"+(courtIndex+1);
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
    if(m.done){
      const prevWinners = m.winner === 'A' ? m.teamA : m.teamB;
      const prevLosers = m.winner === 'A' ? m.teamB : m.teamA;
      prevWinners.forEach(id=>{ const p=playerById(id); if(p) p.wins = Math.max(0,p.wins-1); });
      prevLosers.forEach(id=>{ const p=playerById(id); if(p) p.losses = Math.max(0,p.losses-1); });
    }
    m.scoreA = scoreA; m.scoreB = scoreB;
    m.winner = scoreA > scoreB ? 'A' : 'B';
    m.done = true;
    const winners = m.winner === 'A' ? m.teamA : m.teamB;
    const losers = m.winner === 'A' ? m.teamB : m.teamA;
    winners.forEach(id=>{ const p = playerById(id); if(p) p.wins += 1; });
    losers.forEach(id=>{ const p = playerById(id); if(p) p.losses += 1; });
    pushOrUpdateHistory(courtIndex, court, m);
    if(court.retiring){
      const idx = state.courts.indexOf(court);
      if(idx >= 0) state.courts.splice(idx, 1);
    }
    save();
    renderSchedule();
    renderPlayers();
  }

  // ---------- Generation UI: pick specific players to a side, rest auto-fills ----------
  function startGeneration(courtIndex, advanceRound){
    const court = state.courts[courtIndex];
    if(court.currentMatch && !court.currentMatch.done){
      if(!confirm("這場還沒有確認比分，確定要重新產生對戰嗎？")) return;
    }
    selectionUI = { courtIndex, matchMode: state.mode, teamOf: new Map(), advanceRound };
    renderSchedule();
  }

  function cancelGeneration(){
    selectionUI = null;
    renderSchedule();
  }

  function confirmGeneration(){
    const { courtIndex, matchMode, teamOf, advanceRound } = selectionUI;
    const result = buildMatchFromSides(courtIndex, matchMode, teamOf);
    if(result.error){ alert(result.error); return; }
    applyMatchToCourt(courtIndex, result.teamA, result.teamB, advanceRound);
    selectionUI = null;
    renderSchedule();
    renderPlayers();
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

  function renderScoreRow(court, index){
    const m = court.currentMatch;
    const row = document.createElement("div");
    row.className = "score-input-row";
    const scoreA = document.createElement("input");
    scoreA.type = "number"; scoreA.min = "0"; scoreA.placeholder = "左比分";
    scoreA.value = m.scoreA === null ? "" : m.scoreA;
    const sep = document.createElement("span");
    sep.textContent = ":";
    const scoreB = document.createElement("input");
    scoreB.type = "number"; scoreB.min = "0"; scoreB.placeholder = "右比分";
    scoreB.value = m.scoreB === null ? "" : m.scoreB;
    const btn = document.createElement("button");
    btn.className = "btn small";
    btn.textContent = m.done ? "更新比分" : "確認比分";
    btn.addEventListener("click", ()=>{
      const a = parseInt(scoreA.value, 10);
      const b = parseInt(scoreB.value, 10);
      if(isNaN(a) || isNaN(b) || a < 0 || b < 0){ alert("請輸入兩隊比分"); return; }
      if(a === b){ alert("比分不可相同，請確認"); return; }
      confirmScore(index, a, b);
    });
    row.appendChild(scoreA); row.appendChild(sep); row.appendChild(scoreB); row.appendChild(btn);
    return row;
  }

  function renderGenerationPanel(courtIndex){
    const halfNeed = (selectionUI.matchMode === "doubles" ? 4 : 2) / 2;
    const pool = eligiblePoolForCourt(courtIndex).slice()
      .sort((a,b)=> fairnessScore({members:[a]}) - fairnessScore({members:[b]}));
    const panel = document.createElement("div");
    panel.className = "gen-panel";

    // per-round match-mode override; defaults to the global setting but can change per round
    const modeField = document.createElement("div");
    modeField.className = "field";
    modeField.style.marginBottom = "10px";
    const modeLabel = document.createElement("label");
    modeLabel.textContent = "本輪模式（預設："+(state.mode === "doubles" ? "雙打" : "單打")+"）";
    const modeSelect = document.createElement("select");
    [["doubles","雙打 (4人一場)"],["singles","單打 (2人一場)"]].forEach(([val,label])=>{
      const opt = document.createElement("option");
      opt.value = val; opt.textContent = label;
      if(selectionUI.matchMode === val) opt.selected = true;
      modeSelect.appendChild(opt);
    });
    modeSelect.addEventListener("change", ()=>{
      selectionUI.matchMode = modeSelect.value;
      selectionUI.teamOf.clear();
      renderSchedule();
    });
    modeField.appendChild(modeLabel);
    modeField.appendChild(modeSelect);
    panel.appendChild(modeField);

    const list = document.createElement("div");
    list.className = "pick-list";
    if(!pool.length){
      list.innerHTML = '<div class="muted">目前沒有可選的球員（需已報到、未休息／離場，且不在其他場地上）。</div>';
    }
    pool.forEach(p=>{
      const row = document.createElement("div");
      row.className = "pick-row";
      const info = document.createElement("span");
      info.className = "info";
      info.textContent = p.name+" "+skillDisplay(p.skill)+" · 已上場"+p.gamesPlayed+"次";
      row.appendChild(info);
      const toggle = document.createElement("div");
      toggle.className = "team-toggle";
      const current = selectionUI.teamOf.get(p.id) || "random";
      [["random","隨機"],["left","左隊"],["right","右隊"]].forEach(([val,label])=>{
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        if(current === val) b.classList.add("active");
        b.addEventListener("click", ()=>{
          if(val === "random") selectionUI.teamOf.delete(p.id);
          else selectionUI.teamOf.set(p.id, val);
          renderSchedule();
        });
        toggle.appendChild(b);
      });
      row.appendChild(toggle);
      list.appendChild(row);
    });
    panel.appendChild(list);

    let leftCount = 0, rightCount = 0;
    pool.forEach(p=>{
      const side = selectionUI.teamOf.get(p.id);
      if(side === "left") leftCount++;
      else if(side === "right") rightCount++;
    });
    const countInfo = document.createElement("div");
    countInfo.className = "muted";
    countInfo.style.marginBottom = "8px";
    countInfo.textContent = "左隊已指定 "+leftCount+"/"+halfNeed+"　右隊已指定 "+rightCount+"/"+halfNeed+"　其餘按「確認產生」後自動補上";
    panel.appendChild(countInfo);

    const actionRow = document.createElement("div");
    actionRow.className = "row";
    const confirmBtn = document.createElement("button");
    confirmBtn.className = "btn small";
    confirmBtn.textContent = "確認產生";
    confirmBtn.addEventListener("click", confirmGeneration);
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn secondary small";
    cancelBtn.textContent = "取消";
    cancelBtn.addEventListener("click", cancelGeneration);
    actionRow.appendChild(confirmBtn);
    actionRow.appendChild(cancelBtn);
    panel.appendChild(actionRow);

    return panel;
  }

  function renderCourtCard(court, index){
    const div = document.createElement("div");
    div.className = "court card" + (court.retiring ? " retiring" : "");
    const m = court.currentMatch;
    const roundLabel = court.roundNumber ? ("第 "+court.roundNumber+" 輪") : "尚未開始";
    const retireTag = court.retiring ? '<span class="badge-retiring">最後一輪</span>' : "";
    const head = document.createElement("h3");
    head.innerHTML = `<span>場地 ${index+1} · ${roundLabel}${retireTag}</span>`;
    div.appendChild(head);

    if(m){
      const teamsWrap = document.createElement("div");
      teamsWrap.innerHTML = teamsHtml(m);
      div.appendChild(teamsWrap);
      div.appendChild(renderScoreRow(court, index));
    } else {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "尚未開始，按下方按鈕產生第一輪。";
      div.appendChild(empty);
    }

    if(!court.retiring){
      const btnRow = document.createElement("div");
      btnRow.className = "toolbar";
      const genBtn = document.createElement("button");
      genBtn.className = "btn small";
      genBtn.textContent = m ? "🔀 產生下一輪" : "🔀 產生第一輪";
      genBtn.addEventListener("click", ()=> startGeneration(index, true));
      btnRow.appendChild(genBtn);
      if(m){
        const regenBtn = document.createElement("button");
        regenBtn.className = "btn secondary small";
        regenBtn.textContent = "🎲 重排這一輪";
        regenBtn.addEventListener("click", ()=> startGeneration(index, false));
        btnRow.appendChild(regenBtn);
      }
      div.appendChild(btnRow);
    }

    if(selectionUI && selectionUI.courtIndex === index){
      div.appendChild(renderGenerationPanel(index));
    }

    return div;
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
    const entries = [];
    state.players.forEach(p=>{
      if(p.removed || onCourt.has(p.id)) return;
      let label;
      if(!p.checkedIn) label = "未報到";
      else if(p.left) label = "離場";
      else if(p.resting) label = "休息";
      else label = "候補";
      entries.push({ p, label });
    });
    document.getElementById("waiting-empty").style.display = entries.length ? "none":"block";
    entries.forEach(({p, label})=>{
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = p.name+" "+skillDisplay(p.skill)+" · 已上場"+p.gamesPlayed+"次 ("+label+")";
      wrap.appendChild(chip);
    });
  }

  function renderSchedule(){
    const container = document.getElementById("courts-container");
    container.innerHTML = "";
    state.courts.forEach((court, idx)=>{
      container.appendChild(renderCourtCard(court, idx));
    });
    renderWaitingList();
  }

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
      div.innerHTML = `<h3><span>${h.courtLabel} · 第 ${h.roundNumber} 輪</span></h3>
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

  // ---------- init ----------
  renderPlayers();
  renderSettings();
  renderSchedule();
})();
