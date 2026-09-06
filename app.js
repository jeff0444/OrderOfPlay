(function(){
  "use strict";
  const STORAGE_KEY = "badminton_scheduler_state_v1";
  const SKILL_LABEL = {1:"入門",2:"初階",3:"中階",4:"中高階",5:"高階"};

  function uid(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

  function defaultState(){
    return {
      players: [],           // {id,name,skill,fixedPartnerId,status,gamesPlayed,wins,losses,lastPlayedRound}
      courts: 2,
      mode: "doubles",        // doubles | singles
      roundNumber: 0,
      currentMatches: null,   // [{court,teamA:[id..],teamB:[id..],scoreA,scoreB,done}]
      currentWaiting: [],     // ids sitting out this round
      pairHistory: {},        // "id1|id2" (sorted) -> times partnered
      oppHistory: {},         // "id1|id2" (sorted) -> times opposed
      history: []             // [{roundNumber, matches:[...] }]
    };
  }

  let state = load();

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

  function activePlayers(){
    return state.players.filter(p => p.status === "active");
  }
  function playerById(id){ return state.players.find(p => p.id === id); }
  function pairKey(a,b){ return [a,b].sort().join("|"); }

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
      if(p.status === "removed") return;
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
  }

  document.getElementById("btn-add-player").addEventListener("click", ()=>{
    const nameEl = document.getElementById("np-name");
    const name = nameEl.value.trim();
    if(!name){ nameEl.focus(); return; }
    const skill = parseInt(document.getElementById("np-skill").value, 10);
    const partnerId = document.getElementById("np-partner").value || null;
    const p = makePlayer(name, skill);
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
  function parseRosterLine(line){
    const parts = line.trim().split(/\s+/);
    if(!parts.length || !parts[0]) return null;
    const name = parts[0];
    let skill = 3;
    if(parts[1] && /^[1-5]$/.test(parts[1])) skill = parseInt(parts[1], 10);
    const partnerName = parts.slice(2).join(" ");
    return { name, skill, partnerName: (partnerName && partnerName !== "-") ? partnerName : "" };
  }

  function linkPartnersByName(added){
    added.forEach(({player, partnerName})=>{
      if(!partnerName || player.fixedPartnerId) return;
      const partner = state.players.find(q=>q.name === partnerName && q.id !== player.id && q.status !== "removed");
      if(partner && !partner.fixedPartnerId){
        player.fixedPartnerId = partner.id;
        partner.fixedPartnerId = player.id;
      }
    });
  }

  function makePlayer(name, skill, status){
    return { id: uid(), name, skill, fixedPartnerId: null,
      status: status || "active", gamesPlayed: 0, wins: 0, losses: 0, lastPlayedRound: 0 };
  }

  // parses multi-line roster text and appends players (used by both the
  // page's batch-add box and the "開新場" modal's batch box / CSV import)
  function addRosterFromText(text, defaultStatus){
    const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(l=>l && !l.startsWith("#"));
    const added = [];
    lines.forEach(line=>{
      const parsed = parseRosterLine(line);
      if(!parsed) return;
      const p = makePlayer(parsed.name, parsed.skill, defaultStatus);
      state.players.push(p);
      added.push({ player:p, partnerName: parsed.partnerName });
    });
    linkPartnersByName(added);
    return added;
  }

  document.getElementById("btn-bulk-add").addEventListener("click", ()=>{
    const raw = document.getElementById("bulk-text").value;
    if(!raw.trim()) return;
    const added = addRosterFromText(raw, "active");
    document.getElementById("bulk-text").value = "";
    save();
    renderPlayers();
    alert("已新增 "+added.length+" 位球員");
  });

  document.getElementById("btn-export").addEventListener("click", ()=>{
    const lines = ["# 姓名 程度 搭檔"];
    state.players.filter(p=>p.status !== "removed").forEach(p=>{
      const partner = p.fixedPartnerId ? playerById(p.fixedPartnerId) : null;
      lines.push([p.name, p.skill, partner ? partner.name : "-"].join(" "));
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
        const added = addRosterFromText(reader.result, "active");
        resetSessionState();
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
    state.players.forEach(p=>{ if(p.status !== "removed") p.status = "active"; });
    save();
    renderPlayers();
  });

  const STATUS_LABEL = { active:"已報到", not_arrived:"未報到", resting:"臨時休息", left:"早退" };

  function renderPlayers(){
    refreshPartnerSelect();
    const tbody = document.getElementById("player-table-body");
    tbody.innerHTML = "";
    const visible = state.players.filter(p=>p.status !== "removed");
    document.getElementById("player-empty").style.display = visible.length ? "none":"block";
    document.getElementById("player-count").textContent = visible.length ? "（共 "+visible.length+" 人）" : "";
    visible.forEach(p=>{
      const tr = document.createElement("tr");
      const partner = p.fixedPartnerId ? playerById(p.fixedPartnerId) : null;
      tr.innerHTML = `
        <td>${escapeHtml(p.name)}</td>
        <td><span class="skill">${p.skill}</span> <span class="muted">${SKILL_LABEL[p.skill]}</span></td>
        <td>${partner ? escapeHtml(partner.name) : '<span class="muted">—</span>'}</td>
        <td></td>
        <td>${p.gamesPlayed}</td>
        <td></td>
      `;
      const statusTd = tr.children[3];
      const statusSelect = document.createElement("select");
      statusSelect.className = "status-select status-"+p.status;
      Object.keys(STATUS_LABEL).forEach(key=>{
        const opt = document.createElement("option");
        opt.value = key; opt.textContent = STATUS_LABEL[key];
        statusSelect.appendChild(opt);
      });
      statusSelect.value = p.status;
      statusSelect.addEventListener("change", ()=>{
        p.status = statusSelect.value;
        save(); renderPlayers();
      });
      statusTd.appendChild(statusSelect);
      const actionsTd = tr.querySelector("td:last-child");
      const delBtn = document.createElement("button");
      delBtn.className = "btn danger small";
      delBtn.textContent = "刪除";
      delBtn.style.marginLeft = "4px";
      delBtn.addEventListener("click", ()=>{
        if(!confirm("確定要刪除「"+p.name+"」嗎？")) return;
        if(p.fixedPartnerId){
          const partner = playerById(p.fixedPartnerId);
          if(partner) partner.fixedPartnerId = null;
        }
        p.status = "removed";
        save(); renderPlayers();
      });
      actionsTd.appendChild(delBtn);
      tbody.appendChild(tr);
    });
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  // ---------- Settings tab ----------
  function renderSettings(){
    document.getElementById("s-courts").value = state.courts;
    document.getElementById("s-mode").value = state.mode;
    updateSettingsEcho();
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
    state.courts = Math.max(1, parseInt(document.getElementById("s-courts").value,10) || 1);
    state.mode = document.getElementById("s-mode").value;
    save();
    alert("設定已儲存");
  });

  // ---------- 開新場 modal ----------
  const modalOverlay = document.getElementById("modal-overlay");

  function openModal(){
    document.getElementById("modal-courts").value = state.courts;
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

  function finishOpeningSession(){
    const bulkText = document.getElementById("modal-bulk-text").value;
    if(bulkText.trim()) addRosterFromText(bulkText, "not_arrived");
    state.courts = Math.max(1, parseInt(document.getElementById("modal-courts").value,10) || 1);
    state.mode = document.getElementById("modal-mode").value;
    resetSessionState();
    save();
    renderPlayers(); renderSettings(); renderStats();
    closeModal();
    document.querySelector('nav.tabs button[data-tab="schedule"]').click();
  }

  document.getElementById("modal-start-btn").addEventListener("click", ()=>{
    if(state.roundNumber > 0 || state.history.length > 0){
      if(!confirm("開新場會清除目前的上場次數、比分與歷史紀錄（球員名單會保留），確定要開始新的一場嗎？")) return;
    }
    const file = document.getElementById("modal-file-import").files[0];
    if(file){
      const reader = new FileReader();
      reader.onload = ()=>{
        const lines = reader.result.split(/\r?\n/).map(l=>l.trim()).filter(l=>l && !l.startsWith("#"));
        if(lines.length){
          state.players = [];
          addRosterFromText(reader.result, "not_arrived");
        }
        finishOpeningSession();
      };
      reader.readAsText(file);
    } else {
      finishOpeningSession();
    }
  });

  // ---------- Scheduling algorithm ----------
  function buildUnits(pool){
    // group active players into fixed-pair units (size 2) or solo units (size 1)
    const seen = new Set();
    const units = [];
    pool.forEach(p=>{
      if(seen.has(p.id)) return;
      const partner = (state.mode === "doubles" && p.fixedPartnerId) ? playerById(p.fixedPartnerId) : null;
      if(partner && partner.status === "active" && pool.includes(partner) && !seen.has(partner.id)){
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
    const waited = state.roundNumber - Math.max(...unit.members.map(m=>m.lastPlayedRound));
    return gp * 1000 - waited; // fewer games played first; among ties, longer-waited first
  }

  function selectParticipants(){
    const need = state.mode === "doubles" ? 4 : 2;
    const totalSlots = need * state.courts;
    const pool = activePlayers();
    const units = buildUnits(pool);
    units.sort((a,b)=> fairnessScore(a) - fairnessScore(b) || (Math.random()-0.5));

    const selected = [];
    const skipped = [];
    let remaining = totalSlots;
    units.forEach(u=>{
      if(u.size <= remaining){
        selected.push(u);
        remaining -= u.size;
      } else {
        skipped.push(u);
      }
    });
    return { selected, skipped, need, totalSlots };
  }

  function packGroups(units, need, courts){
    // split `units` (sizes 1 or 2, summing exactly to need*courts) into `courts`
    // groups of exactly `need` members each. Returns null if this ordering can't fit.
    const pairs = units.filter(u=>u.size===2).slice();
    const solos = units.filter(u=>u.size===1).slice();
    const groups = [];
    for(let c=0;c<courts;c++){
      let cap = need;
      const g = [];
      while(cap > 0){
        if(cap >= 2 && pairs.length){
          g.push(pairs.shift()); cap -= 2;
        } else if(solos.length){
          g.push(solos.shift()); cap -= 1;
        } else if(cap >= 2 && !pairs.length && !solos.length){
          return null; // cannot fill
        } else {
          return null; // cap==1 but only pairs left, or nothing left
        }
      }
      groups.push(g);
    }
    if(pairs.length || solos.length) return null;
    return groups;
  }

  function shuffledCopy(arr){
    const a = arr.slice();
    for(let i=a.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [a[i],a[j]] = [a[j],a[i]];
    }
    return a;
  }

  function formTeamsForGroup(group){
    // group: array of units (size1 or 2) totalling 4 members (doubles) or 2 (singles)
    const members = [].concat(...group.map(u=>u.members));
    if(members.length === 2){
      return { teamA:[members[0].id], teamB:[members[1].id] };
    }
    // doubles, 4 members
    const pairUnits = group.filter(u=>u.size===2);
    if(pairUnits.length === 2){
      return { teamA: pairUnits[0].members.map(m=>m.id), teamB: pairUnits[1].members.map(m=>m.id) };
    }
    if(pairUnits.length === 1){
      const pairIds = pairUnits[0].members.map(m=>m.id);
      const solos = group.filter(u=>u.size===1).map(u=>u.members[0]);
      return { teamA: pairIds, teamB: solos.map(m=>m.id) };
    }
    // 4 solos: balance by skill, snake pairing (strongest+weakest vs middle two)
    const sorted = members.slice().sort((a,b)=> b.skill - a.skill);
    return {
      teamA: [sorted[0].id, sorted[3].id],
      teamB: [sorted[1].id, sorted[2].id]
    };
  }

  function repeatPenalty(matches){
    let penalty = 0;
    matches.forEach(m=>{
      const teamA = m.teamA, teamB = m.teamB;
      // partner repeats (only counts if not a declared fixed partnership, since that's expected)
      [teamA, teamB].forEach(team=>{
        if(team.length === 2){
          const [x,y] = team;
          const px = playerById(x), py = playerById(y);
          if(px.fixedPartnerId !== y){
            penalty += (state.pairHistory[pairKey(x,y)] || 0);
          }
        }
      });
      // opponent repeats
      teamA.forEach(x=>{
        teamB.forEach(y=>{
          penalty += (state.oppHistory[pairKey(x,y)] || 0);
        });
      });
    });
    return penalty;
  }

  function generateMatchesFromSelection(selectedUnits, need, courts){
    let best = null, bestPenalty = Infinity;
    const attempts = 60;
    for(let i=0;i<attempts;i++){
      const order = i === 0 ? selectedUnits.slice() : shuffledCopy(selectedUnits);
      const groups = packGroups(order, need, courts);
      if(!groups) continue;
      const matches = groups.map((g, idx)=>{
        const teams = formTeamsForGroup(g);
        return { court: idx+1, teamA: teams.teamA, teamB: teams.teamB, scoreA:null, scoreB:null, done:false };
      });
      const penalty = repeatPenalty(matches);
      if(penalty < bestPenalty){
        bestPenalty = penalty;
        best = matches;
        if(penalty === 0) break;
      }
    }
    return best;
  }

  function generateRound(){
    if(!state.players.some(p=>p.status==="active")){
      alert("目前沒有「在場」的球員，請先到球員頁設定。");
      return;
    }
    const { selected, skipped, need, totalSlots } = selectParticipants();
    const gotSlots = selected.reduce((s,u)=>s+u.size,0);
    if(gotSlots < need){
      alert("在場球員人數不足以開一場比賽（至少需要 "+need+" 人）。");
      return;
    }
    // if not enough for all courts, reduce court count for this round
    const usableCourts = Math.floor(gotSlots / need);
    const matches = generateMatchesFromSelection(selected, need, usableCourts);
    if(!matches){
      alert("排場時發生問題，請按「重新排這一輪」再試一次。");
      return;
    }
    state.roundNumber += 1;
    state.currentMatches = matches;
    const playingIds = new Set();
    matches.forEach(m=>{ m.teamA.forEach(id=>playingIds.add(id)); m.teamB.forEach(id=>playingIds.add(id)); });
    state.currentWaiting = activePlayers().map(p=>p.id).filter(id=>!playingIds.has(id));

    playingIds.forEach(id=>{
      const p = playerById(id);
      p.gamesPlayed += 1;
      p.lastPlayedRound = state.roundNumber;
    });
    applyHistoryCounts(matches);
    save();
    renderSchedule();
    renderPlayers();
  }

  function regenerateRound(){
    // re-roll the CURRENT round's matches without advancing round counter or
    // double counting games played / history.
    if(!state.currentMatches){ generateRound(); return; }
    // revert previous counts for this round first
    revertCurrentRoundCounts();
    const { selected, skipped, need } = selectParticipants();
    const gotSlots = selected.reduce((s,u)=>s+u.size,0);
    const usableCourts = Math.floor(gotSlots / need);
    const matches = generateMatchesFromSelection(selected, need, usableCourts);
    if(!matches){ alert("重新排場失敗，請再試一次。"); return; }
    state.currentMatches = matches;
    const playingIds = new Set();
    matches.forEach(m=>{ m.teamA.forEach(id=>playingIds.add(id)); m.teamB.forEach(id=>playingIds.add(id)); });
    state.currentWaiting = activePlayers().map(p=>p.id).filter(id=>!playingIds.has(id));
    playingIds.forEach(id=>{
      const p = playerById(id);
      p.gamesPlayed += 1;
      p.lastPlayedRound = state.roundNumber;
    });
    applyHistoryCounts(matches);
    save();
    renderSchedule();
    renderPlayers();
  }

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

  function revertCurrentRoundCounts(){
    if(!state.currentMatches) return;
    const playingIds = new Set();
    state.currentMatches.forEach(m=>{ m.teamA.forEach(id=>playingIds.add(id)); m.teamB.forEach(id=>playingIds.add(id)); });
    playingIds.forEach(id=>{
      const p = playerById(id);
      if(p) p.gamesPlayed = Math.max(0, p.gamesPlayed - 1);
    });
    applyHistoryCounts(state.currentMatches, -1);
  }

  function finalizeMatchScore(courtIdx, winner){
    const m = state.currentMatches[courtIdx];
    m.done = true;
    m.winner = winner; // 'A' or 'B'
    const winners = winner === 'A' ? m.teamA : m.teamB;
    const losers = winner === 'A' ? m.teamB : m.teamA;
    winners.forEach(id=>{ const p = playerById(id); if(p) p.wins += 1; });
    losers.forEach(id=>{ const p = playerById(id); if(p) p.losses += 1; });
    save();
  }

  function commitRoundToHistory(){
    if(!state.currentMatches) return;
    state.history.unshift({
      roundNumber: state.roundNumber,
      matches: JSON.parse(JSON.stringify(state.currentMatches)),
      waiting: state.currentWaiting.slice()
    });
    if(state.history.length > 200) state.history.length = 200;
    save();
  }

  // ---------- Schedule tab rendering ----------
  function renderSchedule(){
    const container = document.getElementById("courts-container");
    container.innerHTML = "";
    const empty = document.getElementById("schedule-empty");
    document.getElementById("round-label").textContent = state.roundNumber ? ("第 "+state.roundNumber+" 輪") : "";

    if(!state.currentMatches){
      empty.style.display = "block";
    } else {
      empty.style.display = "none";
      state.currentMatches.forEach((m, idx)=>{
        container.appendChild(renderCourtCard(m, idx));
      });
    }
    renderWaitingList();
  }

  function playerChip(id, teamKey, court, slotIdx){
    const p = playerById(id);
    if(!p) return "";
    const fixedTag = p.fixedPartnerId ? '<span class="badge-fixed">固定</span>' : "";
    return `<span class="nm">${escapeHtml(p.name)} <span class="muted">Lv${p.skill}</span>${fixedTag}</span>`;
  }

  function renderCourtCard(m, idx){
    const div = document.createElement("div");
    div.className = "court";
    const teamAName = m.teamA.map(id=>playerById(id)?.name||"?").join(" / ");
    const teamBName = m.teamB.map(id=>playerById(id)?.name||"?").join(" / ");
    div.innerHTML = `
      <h3><span>場地 ${m.court}</span><span class="muted">${m.done ? (m.winner==='A'? teamAName+' 勝':teamBName+' 勝') : '進行中'}</span></h3>
      <div class="teams">
        <div class="team a">${m.teamA.map(id=>`<div class="p">${playerChip(id)}</div>`).join("")}</div>
        <div class="vs">VS</div>
        <div class="team b">${m.teamB.map(id=>`<div class="p">${playerChip(id)}</div>`).join("")}</div>
      </div>
      <div class="score-row">
        <button class="btn small ${m.done && m.winner==='A' ? '' : 'secondary'}" data-win="A">左邊勝</button>
        <button class="btn small ${m.done && m.winner==='B' ? '' : 'secondary'}" data-win="B">右邊勝</button>
      </div>
    `;
    div.querySelectorAll("[data-win]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        if(m.done){
          // allow correcting result: revert previous win/loss counts first
          const prevWinners = m.winner === 'A' ? m.teamA : m.teamB;
          const prevLosers = m.winner === 'A' ? m.teamB : m.teamA;
          prevWinners.forEach(id=>{ const p=playerById(id); if(p) p.wins = Math.max(0,p.wins-1); });
          prevLosers.forEach(id=>{ const p=playerById(id); if(p) p.losses = Math.max(0,p.losses-1); });
        }
        finalizeMatchScore(idx, btn.dataset.win);
        renderSchedule();
      });
    });
    return div;
  }

  function renderWaitingList(){
    const wrap = document.getElementById("waiting-list");
    wrap.innerHTML = "";
    const entries = [];
    if(state.currentMatches){
      state.currentWaiting.forEach(id=>entries.push({ id, label:"候補" }));
    }
    state.players.forEach(p=>{
      if(p.status === "not_arrived") entries.push({ id:p.id, label:"未報到" });
      else if(p.status === "resting") entries.push({ id:p.id, label:"臨時休息" });
      else if(p.status === "left") entries.push({ id:p.id, label:"早退" });
    });
    document.getElementById("waiting-empty").style.display = entries.length ? "none":"block";
    entries.forEach(({id, label})=>{
      const p = playerById(id);
      if(!p) return;
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = p.name + " ("+label+")";
      wrap.appendChild(chip);
    });
  }

  document.getElementById("btn-generate").addEventListener("click", ()=>{
    if(state.currentMatches) commitRoundToHistory();
    generateRound();
  });
  document.getElementById("btn-regenerate").addEventListener("click", regenerateRound);

  // ---------- Stats tab ----------
  function renderStats(){
    const tbody = document.getElementById("stats-table-body");
    tbody.innerHTML = "";
    const list = state.players.filter(p=>p.status !== "removed")
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
      const lines = h.matches.map(m=>{
        const a = m.teamA.map(id=>playerById(id)?.name||"?").join("/");
        const b = m.teamB.map(id=>playerById(id)?.name||"?").join("/");
        const res = m.done ? (m.winner==='A' ? ` — ${a} 勝` : ` — ${b} 勝`) : "";
        return `場${m.court}: ${a} vs ${b}${res}`;
      }).join("<br>");
      div.innerHTML = `<h3><span>第 ${h.roundNumber} 輪</span></h3><div class="muted" style="font-size:13px;line-height:1.6">${lines}</div>`;
      histWrap.appendChild(div);
    });
  }

  function resetSessionState(){
    state.players.forEach(p=>{ p.gamesPlayed=0; p.wins=0; p.losses=0; p.lastPlayedRound=0; });
    state.roundNumber = 0;
    state.currentMatches = null;
    state.currentWaiting = [];
    state.pairHistory = {};
    state.oppHistory = {};
    state.history = [];
  }

  document.getElementById("btn-reset-stats").addEventListener("click", ()=>{
    if(!confirm("確定要清除所有上場次數、勝負與歷史紀錄嗎？球員名單會保留。")) return;
    resetSessionState();
    save();
    renderPlayers(); renderSchedule(); renderStats();
  });

  // ---------- init ----------
  renderPlayers();
  renderSettings();
  renderSchedule();
})();
