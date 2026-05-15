/**
 * Cricket Mega Tournament Manager
 * Logic for Fixtures, Points Table, and LocalStorage
 */

// --- STATE MANAGEMENT ---
let state = {
    active: false,
    name: "",
    teamCount: 0,
    teams: [],
    matches: [], // Array of objects: {id, team1, team2, team1Score, team2Score, team1Wickets, team2Wickets, overs, status, winner, type}
    playoffs: {
        semi1: null,
        semi2: null,
        final: null,
        champion: null
    }
};

const STORAGE_KEY = "cricket_tourney_data";

// Initialize Lucide Icons
function initIcons() {
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// Load from LocalStorage
function loadState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        state = JSON.parse(saved);
        if (state.active) {
            showDashboard();
        }
    }
}

// Save to LocalStorage
function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// --- UI NAVIGATION ---
function showDashboard() {
    document.getElementById('setup-section').classList.add('d-none');
    document.getElementById('dashboard-section').classList.remove('d-none');
    document.getElementById('reset-btn-container').classList.remove('d-none');
    
    document.getElementById('display-tournament-name').innerText = state.name;
    renderAll();
}

function renderAll() {
    renderFixtures();
    renderPointsTable();
    renderPlayoffs();
    updateStats();
    initIcons();
}

// --- TOURNAMENT CREATION ---
function generateTeamInputs() {
    const count = parseInt(document.getElementById('team-count').value);
    const container = document.getElementById('team-names-container');
    container.innerHTML = "";
    
    if (isNaN(count)) return;

    for (let i = 1; i <= count; i++) {
        const div = document.createElement('div');
        div.className = "col-md-6 mb-3";
        div.innerHTML = `
            <input type="text" class="form-control form-control-lg border-2 rounded-2 team-input" 
                   placeholder="Team ${i} Name" required maxlength="15">
        `;
        container.appendChild(div);
    }
    initIcons();
}

document.addEventListener('DOMContentLoaded', function() {
    console.log("Stumps & Beyond Initialized");
    loadState();
    
    // Setup Form Listener
    const setupForm = document.getElementById('setup-form');
    if (setupForm) {
        setupForm.addEventListener('submit', function(e) {
            e.preventDefault();
            console.log("Setup Form Submitted");
            try {
                const nameInput = document.getElementById('tournament-name');
                const countInput = document.getElementById('team-count');
                
                if (!nameInput.value.trim() || !countInput.value) {
                    alert("Please fill in all tournament details.");
                    return;
                }

                const inputs = document.querySelectorAll('.team-input');
                const teams = Array.from(inputs).map(input => input.value.trim().toUpperCase());
                
                if (teams.some(t => !t)) {
                    alert("All team names are required.");
                    return;
                }

                if (new Set(teams).size !== teams.length) {
                    alert("Team names must be unique!");
                    return;
                }

                if (teams.length < 2) {
                    alert("Please provide at least 2 teams.");
                    return;
                }

                state.active = true;
                state.name = nameInput.value.trim();
                state.teamCount = teams.length;
                state.teams = teams.map(name => ({
                    name,
                    played: 0, won: 0, lost: 0, tied: 0, pts: 0,
                    runsScored: 0, oversFaced: 0, runsConceded: 0, oversBowled: 0, nrr: 0
                }));

                generateLeagueMatches(teams);
                saveState();
                showDashboard();
                console.log("Tournament Launched Successfully");
            } catch (err) {
                console.error("Setup Error:", err);
                alert("Failed to initialize tournament. Error: " + err.message);
            }
        });
    }

    // Team Count Choice Listener
    const teamCountSelect = document.getElementById('team-count');
    if (teamCountSelect) {
        teamCountSelect.addEventListener('change', generateTeamInputs);
    }

    // Search Listener
    const searchInput = document.getElementById('match-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => filterMatches(e.target.value));
    }

    // Reset Button
    const resetBtn = document.getElementById('reset-tournament-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', confirmReset);
    }

    // View Points Button
    const viewPointsBtn = document.getElementById('view-points-btn');
    if (viewPointsBtn) {
        viewPointsBtn.addEventListener('click', renderPointsTable);
    }

    // View Playoffs Button
    const viewPlayoffsBtn = document.getElementById('view-playoffs-btn');
    if (viewPlayoffsBtn) {
        viewPlayoffsBtn.addEventListener('click', renderPlayoffs);
    }

    // Close Champion Button
    const closeChampBtn = document.getElementById('close-champion-btn');
    if (closeChampBtn) {
        closeChampBtn.addEventListener('click', closeChampion);
    }

    // Result Form Listener
    const resultForm = document.getElementById('result-form');
    if (resultForm) {
        resultForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const id = parseInt(document.getElementById('modal-match-id').value);
            const m = state.matches.find(match => match.id === id);
            
            m.team1Score = parseInt(document.getElementById('team1-score').value);
            m.team1Wickets = parseInt(document.getElementById('team1-wickets').value);
            m.team2Score = parseInt(document.getElementById('team2-score').value);
            m.team2Wickets = parseInt(document.getElementById('team2-wickets').value);
            m.team1Overs = parseFloat(document.getElementById('team1-overs').value);
            m.team2Overs = parseFloat(document.getElementById('team2-overs').value);
            m.quota = parseFloat(document.getElementById('match-quota').value);
            m.status = 'completed';

            if (m.team1Score > m.team2Score) m.winner = m.team1;
            else if (m.team2Score > m.team1Score) m.winner = m.team2;
            else m.winner = "Tie";

            const modalEl = document.getElementById('resultModal');
            const modalInstance = bootstrap.Modal.getInstance(modalEl);
            if (modalInstance) modalInstance.hide();
            
            if (m.type === 'final' && m.winner !== 'Tie') {
                state.playoffs.champion = m.winner;
                showConfetti();
            }

            saveState();
            renderAll();
            
            const toastEl = document.getElementById('liveToast');
            if (toastEl) {
                const toast = new bootstrap.Toast(toastEl);
                toast.show();
            }
        });
    }

    initIcons();
});

// --- MATCH SCHEDULING (Round Robin) ---
function generateLeagueMatches(teams) {
    let leagueTeams = [...teams];
    if (leagueTeams.length % 2 !== 0) {
        leagueTeams.push("BYE");
    }

    const n = leagueTeams.length;
    const rounds = n - 1;
    const matchesPerRound = n / 2;
    state.matches = [];

    for (let i = 0; i < rounds; i++) {
        for (let j = 0; j < matchesPerRound; j++) {
            const team1 = leagueTeams[j];
            const team2 = leagueTeams[n - 1 - j];

            if (team1 !== "BYE" && team2 !== "BYE") {
                state.matches.push({
                    id: state.matches.length + 1,
                    team1,
                    team2,
                    team1Score: 0,
                    team1Wickets: 0,
                    team2Score: 0,
                    team2Wickets: 0,
                    overs: 0,
                    status: 'upcoming', // upcoming, completed
                    winner: null,
                    type: 'league'
                });
            }
        }
        // Rotate teams (keeping index 0 fixed)
        leagueTeams.splice(1, 0, leagueTeams.pop());
    }
}

// --- RENDERING ---
function renderFixtures() {
    const container = document.getElementById('fixtures-container');
    container.innerHTML = "";
    
    state.matches.filter(m => m.type === 'league').forEach(match => {
        const card = createMatchCard(match);
        container.appendChild(card);
    });
}

function createMatchCard(match) {
    const div = document.createElement('div');
    div.className = "col-md-6 col-lg-4 match-item animate-up";
    div.dataset.teams = `${match.team1} ${match.team2}`.toLowerCase();
    
    const isCompleted = match.status === 'completed';
    const statusClass = isCompleted ? 'status-completed' : 'status-upcoming';
    const badgeText = isCompleted ? 'Result Final' : 'Match Scheduled';

    div.innerHTML = `
        <div class="card pro-card h-100 p-4 match-card position-relative border-top-0 border-end-0 border-bottom-0 shadow-sm" style="border-left: 4px solid ${isCompleted ? '#cbd5e1' : 'var(--bcci-blue)'}">
            <span class="status-badge ${statusClass}">${badgeText}</span>
            <div class="small fw-bold text-muted text-uppercase mb-4 mt-1 ls-1" style="font-size: 0.65rem;">
                Match #${match.id} • LEAGUE STAGE
            </div>
            
            <div class="row align-items-center mb-4 g-0">
                <div class="col-5 text-center">
                    <div class="team-logo-placeholder mx-auto mb-2">${match.team1.substring(0,3)}</div>
                    <div class="fw-bold text-navy small text-uppercase lh-1">${match.team1}</div>
                    <div class="score-num mt-2">${isCompleted ? match.team1Score + '/' + match.team1Wickets : '-'}</div>
                </div>
                <div class="col-2 text-center">
                    <div class="small fw-bold text-muted" style="font-size: 0.6rem;">VS</div>
                </div>
                <div class="col-5 text-center">
                    <div class="team-logo-placeholder mx-auto mb-2">${match.team2.substring(0,3)}</div>
                    <div class="fw-bold text-navy small text-uppercase lh-1">${match.team2}</div>
                    <div class="score-num mt-2">${isCompleted ? match.team2Score + '/' + match.team2Wickets : '-'}</div>
                </div>
            </div>

            <div class="d-flex justify-content-between align-items-center mt-3 pt-3 border-top">
                <div class="result-summary">
                    ${isCompleted ? 
                        `<span class="text-navy fw-bold small text-uppercase" style="font-size: 10px;"><i data-lucide="check-circle" class="text-success d-inline-block me-1" style="width:12px"></i> ${match.winner === 'Tie' ? 'Match Tied' : match.winner + ' Won'}</span>` : 
                        '<span class="text-muted small fw-bold text-uppercase" style="font-size: 10px;">Pre-Match</span>'}
                </div>
                <button class="btn btn-navy text-white bg-bcci-blue btn-sm px-3 fw-bold rounded-1" onclick="openUpdateModal(${match.id})" style="font-size: 0.65rem;">
                    ${isCompleted ? 'EDIT' : 'ENTER RESULT'}
                </button>
            </div>
        </div>
    `;
    return div;
}

function filterMatches(term) {
    const items = document.querySelectorAll('.match-item');
    term = term.toLowerCase();
    items.forEach(item => {
        if (item.dataset.teams.includes(term)) {
            item.classList.remove('d-none');
        } else {
            item.classList.add('d-none');
        }
    });
}

// --- RESULT MANAGEMENT ---
function openUpdateModal(matchId) {
    const match = state.matches.find(m => m.id === matchId);
    document.getElementById('modal-match-id').value = matchId;
    document.getElementById('team1-label').innerText = match.team1;
    document.getElementById('team2-label').innerText = match.team2;
    
    document.getElementById('team1-score').value = match.team1Score || '';
    document.getElementById('team1-wickets').value = match.team1Wickets || '';
    document.getElementById('team2-score').value = match.team2Score || '';
    document.getElementById('team2-wickets').value = match.team2Wickets || '';
    document.getElementById('team1-overs').value = match.team1Overs || '';
    document.getElementById('team2-overs').value = match.team2Overs || '';
    document.getElementById('match-quota').value = match.quota || '';

    const modal = new bootstrap.Modal(document.getElementById('resultModal'));
    modal.show();
}

// Starting Point removed from here and moved to DOMContentLoaded listener above

// --- POINTS TABLE CALCULATION ---
function calculatePointsTable() {
    // Reset stats
    const table = state.teams.map(t => ({
        name: t.name, played: 0, won: 0, lost: 0, tied: 0, pts: 0,
        runsScored: 0, oversFaced: 0, runsConceded: 0, oversBowled: 0, nrr: 0
    }));

    state.matches.filter(m => m.status === 'completed' && m.type === 'league').forEach(m => {
        const t1 = table.find(t => t.name === m.team1);
        const t2 = table.find(t => t.name === m.team2);

        t1.played++; t2.played++;
        t1.runsScored += m.team1Score; t1.runsConceded += m.team2Score;
        t2.runsScored += m.team2Score; t2.runsConceded += m.team1Score;

        // Use individual team overs for NRR
        t1.oversFaced += m.team1Overs; t1.oversBowled += m.team2Overs;
        t2.oversFaced += m.team2Overs; t2.oversBowled += m.team1Overs;

        if (m.winner === m.team1) { t1.won++; t1.pts += 2; t2.lost++; }
        else if (m.winner === m.team2) { t2.won++; t2.pts += 2; t1.lost++; }
        else { t1.tied++; t1.pts += 1; t2.tied++; t2.pts += 1; }
    });

    // Calculate NRR
    table.forEach(t => {
        if (t.oversFaced > 0) {
            // Cricket math: 15.3 overs = 15.5 decimal
            const convertToDecimal = (overs) => {
                const fullOvers = Math.floor(overs);
                const balls = Math.round((overs - fullOvers) * 10);
                return fullOvers + (balls / 6);
            };

            const decimalFaced = convertToDecimal(t.oversFaced);
            const decimalBowled = convertToDecimal(t.oversBowled);

            const runRateFaced = t.runsScored / decimalFaced;
            const runRateAgainst = t.runsConceded / decimalBowled;
            t.nrr = (runRateFaced - runRateAgainst).toFixed(3);
        }
    });

    // Sort: Points DESC, then NRR DESC
    return table.sort((a, b) => b.pts - a.pts || b.nrr - a.nrr);
}

function renderPointsTable() {
    const table = calculatePointsTable();
    const tbody = document.getElementById('points-tbody');
    tbody.innerHTML = "";

    table.forEach((team, index) => {
        const tr = document.createElement('tr');
        if (index === 0) tr.classList.add('top-team');
        tr.innerHTML = `
            <td class="text-center fw-bold text-navy">${index + 1}</td>
            <td class="text-start fw-bold text-navy">${team.name}</td>
            <td class="text-center">${team.played}</td>
            <td class="text-center text-success fw-bold">${team.won}</td>
            <td class="text-center text-danger">${team.lost}</td>
            <td class="text-center">${team.tied}</td>
            <td class="text-center text-muted small">${team.nrr}</td>
            <td class="text-center fw-bold fs-6 text-navy">${team.pts}</td>
        `;
        tbody.appendChild(tr);
    });

    if (table.length > 0) {
        document.getElementById('stat-winner').innerText = table[0].name;
    }
}

// --- PLAYOFFS SYSTEM ---
function renderPlayoffs() {
    const container = document.getElementById('playoffs-container');
    const table = calculatePointsTable();
    const totalLeague = state.matches.filter(m => m.type === 'league');
    const completedLeague = totalLeague.filter(m => m.status === 'completed');

    if (completedLeague.length < totalLeague.length) {
        return; // Still in progress
    }

    container.innerHTML = "";
    
    // Top 4 Teams
    const top4 = table.slice(0, 4);
    if (top4.length < 2) return;

    // Check if semis already generated
    const hasSemis = state.matches.some(m => m.type === 'semi-final');
    if (!hasSemis) {
        generateSemis(top4);
    }

    const semis = state.matches.filter(m => m.type === 'semi-final');
    const final = state.matches.find(m => m.type === 'final');

    // Render Semi Finals
    const s1Div = document.createElement('div');
    s1Div.className = "mb-5";
    s1Div.innerHTML = `
        <h4 class="text-center mb-4 text-secondary text-uppercase small ls-wider">Semi Finals</h4>
        <div class="row g-4 justify-content-center">
            ${semis.map(m => `
                <div class="col-md-6 col-lg-5">
                    ${createMatchCard(m).outerHTML}
                </div>
            `).join('')}
        </div>
    `;
    container.appendChild(s1Div);

    // Check if Final can be generated
    const semisComplete = semis.every(s => s.status === 'completed');
    if (semisComplete && !final) {
        generateFinal(semis);
    }

    if (final) {
        const fDiv = document.createElement('div');
        fDiv.className = "mb-5 text-center";
        fDiv.innerHTML = `
            <i data-lucide="crown" class="text-warning mb-2" style="width:48px; height:48px"></i>
            <h2 class="fw-bold mb-4">THE GRAND FINAL</h2>
            <div class="row justify-content-center">
                <div class="col-md-6">
                    ${createMatchCard(final).outerHTML}
                </div>
            </div>
        `;
        container.appendChild(fDiv);
    }

    if (state.playoffs.champion) {
        document.getElementById('champion-team-name').innerText = state.playoffs.champion;
        document.getElementById('champion-overlay').classList.remove('d-none');
    }
}

function generateSemis(top4) {
    // Semi 1: 1st vs 4th (if 4 teams) or auto handle if less
    const s1Teams = [top4[0].name, top4[3] ? top4[3].name : top4[1].name];
    const s2Teams = [top4[1].name, top4[2] ? top4[2].name : top4[0].name]; // fallback

    state.matches.push({
        id: state.matches.length + 1,
        team1: s1Teams[0], team2: s1Teams[1],
        team1Score: 0, team1Wickets: 0, team2Score: 0, team2Wickets: 0,
        overs: 0, status: 'upcoming', winner: null, type: 'semi-final'
    });

    state.matches.push({
        id: state.matches.length + 1,
        team1: s2Teams[0], team2: s2Teams[1],
        team1Score: 0, team1Wickets: 0, team2Score: 0, team2Wickets: 0,
        overs: 0, status: 'upcoming', winner: null, type: 'semi-final'
    });
    saveState();
}

function generateFinal(semis) {
    const f1Winner = semis[0].winner;
    const f2Winner = semis[1].winner;

    if (f1Winner && f2Winner && f1Winner !== 'Tie' && f2Winner !== 'Tie') {
        state.matches.push({
            id: state.matches.length + 1,
            team1: f1Winner, team2: f2Winner,
            team1Score: 0, team1Wickets: 0, team2Score: 0, team2Wickets: 0,
            overs: 0, status: 'upcoming', winner: null, type: 'final'
        });
        saveState();
    }
}

// --- UTILS ---
function updateStats() {
    const league = state.matches.filter(m => m.type === 'league');
    document.getElementById('stat-matches').innerText = league.length;
    document.getElementById('stat-completed').innerText = league.filter(m => m.status === 'completed').length;
    document.getElementById('stat-teams').innerText = state.teamCount;
}

function confirmReset() {
    if (confirm("🚨 Are you sure you want to reset the tournament? All data will be permanently deleted.")) {
        localStorage.removeItem(STORAGE_KEY);
        window.location.reload();
    }
}

function closeChampion() {
    document.getElementById('champion-overlay').classList.add('d-none');
}

function showConfetti() {
    const duration = 5 * 1000;
    const end = Date.now() + duration;

    (function frame() {
        confetti({
            particleCount: 5,
            angle: 60,
            spread: 55,
            origin: { x: 0 },
            colors: ['#4f46e5', '#f59e0b', '#ffffff']
        });
        confetti({
            particleCount: 5,
            angle: 120,
            spread: 55,
            origin: { x: 1 },
            colors: ['#4f46e5', '#f59e0b', '#ffffff']
        });

        if (Date.now() < end) {
            requestAnimationFrame(frame);
        }
    }());
}

// Global scope access for HTML onclicks
window.openUpdateModal = openUpdateModal;
window.confirmReset = confirmReset;
window.closeChampion = closeChampion;
window.filterMatches = filterMatches;
window.generateTeamInputs = generateTeamInputs;
window.renderPointsTable = renderPointsTable;
window.renderPlayoffs = renderPlayoffs;

// Starting Point removed from here and moved to DOMContentLoaded listener above
